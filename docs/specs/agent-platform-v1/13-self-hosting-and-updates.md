# Self-Hosting and Update Strategy

## Goal
Define how Proliferate is deployed, upgraded, and operated outside managed cloud, without ambiguity.

This is a product requirement, not only infra detail.

## Deployment modes

### A) Managed cloud (default)
- Proliferate team operates web, gateway, worker, trigger-service, DB, and billing stack.
- Customer connects integrations and uses hosted runtime.

### B) Self-host Docker
- Customer runs platform services via Docker Compose or equivalent container runtime.
- Best for single-team/self-managed deployments.
- Provider choice remains configurable.

### C) Self-host Kubernetes
- Customer deploys platform services in Kubernetes (Helm + Postgres + Redis baseline).
- Best for multi-team and stricter SRE controls.

Kubernetes runtime networking contract:
- Gateway and sandbox pods must run inside the same cluster/VPC trust boundary.
- Gateway connects to sandbox-daemon via internal cluster routing (Service DNS or pod IP).
- Do not depend on creating external ingress resources per short-lived session pod.
- Browser traffic still goes only to web/gateway ingress; browser never connects directly to sandbox pods.

Kubernetes state persistence contract:
- Worker coding sessions that need pause/resume parity must mount a session-scoped PVC at `/workspace`.
- When a worker pod idles out, pod may be destroyed but PVC remains bound to `sessionId`.
- Resume path must reattach the same PVC before continuing work.
- Lean manager sessions are ephemeral by default and do not require PVC persistence unless explicitly configured.

AZ/zone scheduling safety (required for RWO volumes):
- If storage class is zonal + `ReadWriteOnce` (EBS/PersistentDisk), resume scheduling must honor PVC zone affinity.
- Resume controller must schedule replacement pod in the same zone as the bound PVC.
- If same-zone scheduling cannot be guaranteed, operators must use RWX-capable shared storage (for example EFS/Filestore) for session workspaces.
- Avoid ambiguous cross-zone resume behavior that can deadlock pod attach in `ContainerCreating`.

### D) Enterprise controlled environment
- Same as self-host, with stricter network/policy constraints.
- Customer controls ingress, secrets manager, observability stack, and upgrade windows.

## V1 support matrix

| Mode | Support status | Notes |
|---|---|---|
| Managed cloud | Supported | Default customer path |
| Self-host Docker | Supported | Fastest self-host path |
| Self-host Kubernetes | Supported | Recommended for larger orgs |

## Implementation file tree (self-host and update surfaces)

```text
charts/proliferate/                    # Helm chart for app services
infra/pulumi-k8s/                      # AWS EKS IaC
infra/pulumi-k8s-gcp/                  # GKE IaC
packages/environment/src/schema.ts     # canonical env var schema
packages/db/drizzle/                   # DB migrations
apps/web/src/server/routers/admin.ts   # admin/update runtime controls (where applicable)
```

Operational references:
- `/Users/pablo/proliferate/docs/specs/sandbox-providers.md`
- `/Users/pablo/proliferate/docs/specs/billing-metering.md`

## Runtime architecture expectations for self-host

Required services:
- `web` (UI + API routers)
- `gateway` (runtime stream + action boundary)
- `worker` (async orchestration)
- `trigger-service` (webhook and polling ingestion)
- Postgres (durable state)
- Redis (queues/coordination where configured)

Optional/external:
- E2B/Modal provider endpoints
- external observability stack
- customer-managed secrets manager (recommended)

## Update channels

### Application versioning
- Container images are versioned by semver tag and immutable digest.
- Helm values pin explicit image tags for each service.

### Database versioning
- All schema changes must ship as forward migrations in `packages/db/drizzle/`.
- App version compatibility matrix:
  - `N` app supports schema `N` and `N-1` during rolling deploy window.
  - destructive migration steps require explicit release notes + operator action.

### Config versioning
- Env schema changes are tracked in `packages/environment/src/schema.ts`.
- Breaking env changes require startup validation errors with actionable messaging.

## Upgrade process (self-host operator runbook)

1. Preflight:
- Validate target version compatibility notes.
- Backup Postgres and critical object storage artifacts.
- Verify secrets and env var schema compatibility.

2. Schema migration:
- Apply DB migrations first.
- Confirm migration health and lock duration bounds.

3. Service rollout:
- Roll `worker` + `trigger-service` first (consumer compatibility).
- Roll `gateway` next.
- Roll `web` last.

4. Post-deploy checks:
- Session create/pause/resume smoke test.
- Action invoke/approval flow smoke test.
- Trigger ingestion and outbox dispatch smoke test.
- Billing event pipeline health check.

5. Rollback:
- Rollback app images to previous version.
- DB rollback only if release notes explicitly declare reversible migration path.

## Self-hosting support for E2B-specific patterns

If operator chooses E2B as provider:
- Runtime uses provider host resolution per port (`getHost(port)` semantics).
- Paused sandboxes drop active network streams; gateway reconnect behavior is mandatory.
- Snapshot/pause behavior should be treated as optimization, not correctness source.

(Reference obtained from E2B docs via Context7.)

## Security requirements for self-host

- No direct browser-to-sandbox tunnel exposure.
- Gateway remains mandatory policy and auth boundary.
- Secret sources should be pluggable (K8s secrets, external secret manager).
- Audit tables must remain enabled and queryable in all deployment modes.

## Core data models impacted by upgrades

| Model | Upgrade sensitivity | File |
|---|---|---|
| `sessions` | runtime compatibility, status transitions, reconnect behavior | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | approval and action replay correctness | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | long-running orchestration continuity | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `outbox` | delivery reliability across deploys | `packages/db/src/schema/schema.ts` (`outbox`) |
| `billing_events` | financial correctness during rollouts | `packages/db/src/schema/billing.ts` |

## Definition of done checklist
- [ ] Self-host deployment topology is documented and reproducible
- [ ] Upgrade order and rollback policy are explicitly defined
- [ ] DB migration compatibility contract is documented
- [ ] Health checks cover runtime, actions, triggers, and billing paths
- [ ] Security boundary remains identical in cloud and self-host modes
