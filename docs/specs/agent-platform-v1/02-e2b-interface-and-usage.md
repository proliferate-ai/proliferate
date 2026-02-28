# E2B Interface and Usage Pattern (V1)

## Goal
Use E2B as the only execution provider in V1, while keeping code structured so we can add Docker/K8s later without rewriting control-plane logic.

## Hard boundary
- Control plane decides **when** to run
- E2B provider decides **how** to start/stop/exec in sandbox
- Business logic must not call E2B SDK directly outside provider layer

Primary code path today:
- [e2b.ts](/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts)
- [providers/index.ts](/Users/pablo/proliferate/packages/shared/src/providers/index.ts)
- [gateway session runtime](/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts)
- [gateway session hub](/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts)
- [snapshot resolution helper](/Users/pablo/proliferate/packages/shared/src/snapshot-resolution.ts)

## File tree for provider boundary

```text
packages/shared/src/providers/
  e2b.ts                    # E2B implementation
  modal-libmodal.ts         # existing alt provider reference
  index.ts                  # provider factory/selection

apps/gateway/src/hub/
  session-runtime.ts        # asks provider to ensure sandbox, tracks readiness
  session-hub.ts            # stream lifecycle, reconnect, runtime fanout

packages/services/src/sessions/
  db.ts                     # durable session metadata updates (sandbox ids, status)
```

## Core data models touched by provider lifecycle

| Model | Why it matters | File |
|---|---|---|
| `sessions` | Stores `sandboxId`, provider, status, tunnel URLs, pause state | `packages/db/src/schema/sessions.ts` |
| `configurations` | Default snapshot/config selection for faster start | `packages/db/src/schema/configurations.ts` |
| `repos` | Repo identity and setup context used during boot | `packages/db/src/schema/repos.ts` |

## Provider contract (V1 expected behavior)
Provider must support:
- Ensure sandbox exists
- Execute command(s)
- Stream output/events via gateway runtime path
- Pause/resume by sandbox id when available
- Destroy sandbox

Control-plane code should only call provider abstraction, not vendor SDK types.

## Boot flow (E2B)
1. Session runtime asks provider to ensure sandbox
2. Provider resolves sandbox identity (`currentSandboxId` or create new)
3. Provider injects runtime env (session id, gateway URL/token, env bundle values, non-sensitive config)
4. Provider may inject short-lived repo-scoped git credential for sandbox-native git operations
5. Sandbox starts `sandbox-daemon` and runtime processes
6. Provider resolves ingress host by explicit daemon port (E2B `getHost(port)`)
7. Gateway performs signed readiness probe against daemon ingress endpoint and marks runtime ready

Transport direction rule:
- Runtime transport uses Gateway -> Sandbox ingress over provider tunnel.
- Browser never receives provider hostnames directly.

## Pause/Resume flow (E2B)
- Pause:
  - Triggered by idle policy (default `10m`), including approval-wait idle periods
  - Provider pause call executed (`betaPause` path in E2B SDK)
  - Session row updated with paused state and snapshot/sandbox reference
- Resume:
  - Resolve pinned compute identity from run/session `boot_snapshot` (`provider/templateId/imageDigest`)
  - Provider reconnect by stored id (`connect()` resumes paused E2B sandboxes)
  - Runtime restarts stream
  - Session continues from durable DB context

Network caveat from E2B behavior:
- Paused sandboxes drop active network connections.
- On resume, terminal/preview clients must reattach.

## Snapshot/setup strategy (V1)
Use E2B capabilities pragmatically:
- Snapshot is optimization, not correctness dependency
- Correctness comes from DB state + reproducible workspace steps

Recommended V1 behavior:
- On first repo setup, let setup run complete and persist metadata
- For recurring work, resume existing sandbox when possible
- If sandbox missing/expired, rebuild quickly from known setup path
- Use a "fat" E2B template for coding runs (Playwright + browser support) so final outputs can include visual proof artifacts
- Always run a git freshness step before task execution (`git fetch` + reset/rebase policy) so cached sandbox state does not drift from remote

## Setup snapshot refresh policy
To avoid stale snapshots:

1. Detect dependency-shape changes on default branch (`package-lock`, `pnpm-lock`, `poetry.lock`, `requirements*`, `Dockerfile`, `.devcontainer/*`).
2. Mark configuration snapshot stale.
3. Rebuild baseline setup snapshot asynchronously.
4. New sessions use refreshed snapshot; existing active sessions continue until completion.

## Security requirements
- Do not inject privileged long-lived tokens into sandbox by default
- Sandbox-native git operations may use short-lived, repo-scoped credentials (ephemeral)
- Keep non-git action/integration execution server-side
- Sandbox can request actions; gateway approves/executes

## Failure handling
Common failures and expected response:
- Sandbox create fails: mark session failed with retry metadata
- Sandbox pause fails: log and continue with stop fallback
- Resume id not found: create new sandbox and recover from durable state
- Stream disconnect: retry attach with bounded backoff

## Telemetry required for E2B V1
Track per session:
- Sandbox create latency
- Time to first output
- Resume latency
- Pause success rate
- Failures by class (create, exec, resume, stream)
- Reattach success rate after pause/resume

## Non-goals (V1)
- Cross-provider state portability
- Kubernetes scheduling features
- Full snapshot productization UI

## Definition of done checklist
- [ ] All runtime execution goes through provider abstraction
- [ ] E2B boot/exec/pause/resume/destroy implemented reliably
- [ ] Failure paths are explicit with retries/fallbacks
- [ ] Security boundary preserved (server-side credential execution)
- [ ] Basic E2B telemetry emitted and queryable
- [ ] Runtime readiness is based on signed inbound daemon readiness check via provider tunnel
- [ ] Snapshot refresh path exists for dependency and environment drift
