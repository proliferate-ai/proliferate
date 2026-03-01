# Self-Hosting and Update Strategy

## Goal
Define how Proliferate is deployed, upgraded, and operated outside managed cloud, without ambiguity.

This is a product requirement, not only infra detail.

Clean-slate assumption:
- This spec targets the rewrite baseline.
- No legacy cutover or backward-compatibility track is required for initial release.

## Deployment modes

### A) Managed cloud (default)
- Proliferate team operates web, gateway, worker, trigger-service, DB, and billing stack.
- Customer connects integrations and uses hosted runtime.

### B) Self-host Docker
- Customer runs platform services via Docker Compose or equivalent container runtime.
- Best for single-team/self-managed deployments.
- Sandbox compute still runs on E2B in V1.

### C) Self-host Kubernetes
- Customer deploys platform services in Kubernetes (Helm + Postgres + Redis baseline).
- Best for multi-team and stricter SRE controls.
- Sandbox compute still runs on E2B in V1.

### D) Enterprise controlled environment
- Same as self-host, with stricter network/policy constraints.
- Customer controls ingress, secrets manager, observability stack, and upgrade windows.

## V1 support matrix

Control plane hosting:

| Mode | Support status | Notes |
|---|---|---|
| Managed cloud | Supported | Default customer path |
| Self-host Docker | Supported | Fastest self-host path |
| Self-host Kubernetes | Supported | Recommended for larger orgs |

Sandbox compute provider:

| Provider | V1 status | Notes |
|---|---|---|
| E2B | Supported | Required in all deployment modes for V1 |
| Self-host Docker/Kubernetes sandbox provider | Future | Not in V1 implementation contract |
| Modal | Out of scope | Not part of this V1 spec pack |

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
- In-house OAuth/token services (inside `web` + `packages/services/src/integrations`) for core providers

Optional/external:
- E2B provider endpoints (required for sandbox compute)
- ngrok (or equivalent public tunnel) only when needed for local dev, OAuth callback, or optional webhook ingress
- external observability stack
- customer-managed secrets manager (recommended)
- third-party OAuth brokers (not required)

## Update channels

### Application versioning
- Container images are versioned by semver tag and immutable digest.
- Helm values pin explicit image tags for each service.

### Database versioning
- All schema changes must ship as forward migrations in `packages/db/drizzle/`.
- App release notes must state required schema version and any destructive/operator-managed steps.

### Config versioning
- Env schema changes are tracked in `packages/environment/src/schema.ts`.
- Breaking env changes require startup validation errors with actionable messaging.

## Upgrade process (self-host operator runbook)

1. Preflight:
- Validate target version release notes.
- Backup Postgres and critical object storage artifacts.
- Verify secrets and env var schema requirements.

2. Schema migration:
- Apply DB migrations first.
- Confirm migration health and lock duration bounds.

3. Service rollout:
- Roll `worker` + `trigger-service` first.
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

V1 compute contract:
- E2B is mandatory for sandbox execution in managed and self-host control-plane deployments.

Required E2B behavior:
- Runtime uses provider host resolution per port (`getHost(port)` semantics).
- Paused sandboxes drop active network streams; gateway reconnect behavior is mandatory.
- Snapshot/pause behavior should be treated as optimization, not correctness source.

Core wake model in self-host:
- Core coworker operation does not require inbound public webhooks.
- Tick -> wake manager session -> manager inspects sources/tools -> manager decides orchestration/actions.
- Optional webhooks feed same durable trigger pipeline when enabled.

(Reference obtained from E2B docs via Context7.)

## Security requirements for self-host

- No direct browser-to-sandbox tunnel exposure.
- Gateway remains mandatory policy and auth boundary.
- Browser should never connect directly to E2B sandbox runtime.
- Secret sources should be pluggable (K8s secrets, external secret manager).
- Audit tables must remain enabled and queryable in all deployment modes.
- OAuth token lifecycle (exchange/refresh/revoke) must run within Proliferate control plane, with encrypted token storage and no broker lock-in.
- Sandbox-integrated SaaS access should primarily route through gateway-backed tools instead of unconstrained sandbox egress.

## Core data models impacted by upgrades

| Model | Upgrade sensitivity | File |
|---|---|---|
| `sessions` | runtime behavior, status transitions, reconnect behavior | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | approval and action replay correctness | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | long-running orchestration continuity | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `outbox` | delivery reliability across deploys | `packages/db/src/schema/schema.ts` (`outbox`) |
| `billing_events` | financial correctness during rollouts | `packages/db/src/schema/billing.ts` |

## Definition of done checklist
- [ ] Self-host deployment topology is documented and reproducible
- [ ] Upgrade order and rollback policy are explicitly defined
- [ ] DB upgrade contract is documented
- [ ] Health checks cover runtime, actions, triggers, and billing paths
- [ ] Security boundary remains identical in cloud and self-host modes
