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
3. Provider injects runtime env (session id, gateway URL/token, non-sensitive config)
4. Sandbox starts OpenCode/service process
5. Sandbox PID 1 (`/supervisor`) dials an outbound websocket to Gateway using `BRIDGE_TOKEN`; Gateway authenticates and marks runtime ready

## Pause/Resume flow (E2B)
- Pause:
  - Triggered by idle policy or approval wait
  - Provider pause call executed
  - Session row updated with paused state and snapshot/sandbox reference
- Resume:
  - Provider resume/reconnect by stored id
  - Runtime restarts stream
  - Session continues from durable DB context

## Snapshot/setup strategy (V1)
Use E2B capabilities pragmatically:
- Snapshot is optimization, not correctness dependency
- Correctness comes from DB state + reproducible workspace steps

Recommended V1 behavior:
- On first repo setup, let setup run complete and persist metadata
- For recurring work, resume existing sandbox when possible
- If sandbox missing/expired, rebuild quickly from known setup path
- Use a \"fat\" E2B template for coding runs (Playwright + browser support) so final outputs can include visual proof artifacts

## Security requirements
- Do not inject privileged long-lived tokens into sandbox by default
- Keep gateway action execution server-side
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
- [ ] Runtime readiness is based on outbound sandbox bridge auth, not inbound sandbox control channel
