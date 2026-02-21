# Sessions & Gateway — System Spec

## 1. Scope & Purpose

### In Scope
- Session lifecycle orchestration: create, eager-start, pause, snapshot, stop, status, delete, rename.
- Gateway runtime orchestration: hub ownership, sandbox lifecycle, OpenCode session lifecycle, SSE streaming, reconnect.
- Distributed safety primitives: owner/runtime leases, migration locks, CAS/fencing writes, orphan sweep recovery.
- Real-time protocol surface: WebSocket session protocol, HTTP prompt/cancel/info/status/tool routes.
- Gateway-intercepted tool execution over synchronous sandbox callbacks.
- Expiry/idle behavior: BullMQ expiry jobs, idle snapshotting, automation fast-path termination.
- Session telemetry capture and flush pipeline (`metrics`, `pr_urls`, `latest_task`).
- Devtools and OpenCode proxying via gateway (`/proxy/*`) including sandbox-mcp auth token injection.
- Gateway client library contracts (`packages/gateway-clients`) used by web and workers.
- Session-focused web surfaces backed by the above contracts (session list, peek drawer, inbox session context).

### Out of Scope
- Sandbox provider internals (Modal/E2B implementation details, image contents, provider deployment) — see `sandbox-providers.md`.
- Tool schemas/prompt contract and capability policy — see `agent-contract.md`.
- Automation run DAG, scheduling, and notification fanout — see `automations-runs.md`.
- Repo/configuration CRUD and prebuild policy — see `repos-prebuilds.md`.
- OAuth connection lifecycle and Nango sync — see `integrations.md`.
- Billing policy design and pricing semantics — see `billing-metering.md`.

### Mental Models
- **Control plane vs stream plane:** Next.js/oRPC/API routes create and mutate metadata; live model streaming is only Client ↔ Gateway ↔ Sandbox.
- **Session record vs hub vs runtime:** DB session row is durable metadata; `SessionHub` is per-process coordination state; `SessionRuntime` owns sandbox/OpenCode/SSE readiness.
- **Creation vs activation:** Creating a session record does not guarantee a sandbox exists. Runtime activation happens when a hub ensures readiness (or eager-start runs).
- **Ownership vs liveness:** Owner lease answers "which gateway instance may act"; runtime lease answers "is there a live runtime heartbeat".
- **Idle is a predicate, not just "no sockets":** idle snapshot requires no WS clients, no proxy clients, no active HTTP tool callbacks, no running tools, no active assistant turn, and grace-period satisfaction.
- **Migration/snapshot writes are fenced:** DB transitions that depend on a specific sandbox use CAS (`updateWhereSandboxIdMatches`) so stale actors cannot clobber newer state.
- **Recovery is multi-path:** runtime reconnect and expiry are job-driven; orphan cleanup is DB-first + runtime-lease-based and works even when no hub exists in memory.
- **Automation sessions are logically active even when headless:** automation client type is treated as having an effective client so expiry migration/reconnect behavior remains active.

### Things Agents Get Wrong
- Assuming API routes are in the token streaming path. They are not.
- Assuming one creation path. There are two materially different pipelines: gateway HTTP creation and web oRPC creation.
- Assuming session creation always provisions sandboxes. Deferred mode and oRPC create both return before provisioning.
- Assuming `userId` from client payload is trusted. The hub derives identity from authenticated connection/auth context.
- Assuming owner lease is optional or post-runtime. Lease acquisition gates runtime lifecycle work.
- Assuming runtime lease implies ownership. It is a liveness heartbeat, not ownership authority.
- Assuming expiry migration is triggered by an in-process timer. Current code relies on BullMQ delayed jobs plus local lifecycle decisions.
- Assuming hub eviction/hard-cap LRU exists centrally. Current `HubManager` is a registry + lifecycle hooks; eviction is explicit via hub callbacks.
- Assuming tool callback idempotency is global. It is in-memory per gateway process.
- Assuming SSE carries bidirectional traffic. SSE is read-only (sandbox → gateway); prompts/cancel are HTTP.
- Assuming preview/devtools proxies can skip session readiness checks. Most proxy routes require runtime readiness to resolve targets.
- Assuming markdown summaries are safe to render raw. UI must use sanitized markdown renderer.

---

## 2. Core Concepts

### Hub Manager
`HubManager` is an in-process registry keyed by session ID.

- `getOrCreate(sessionId)` deduplicates concurrent constructors via a pending promise map.
- Hub creation always starts by loading fresh DB-backed session context.
- `remove(sessionId)` is lifecycle cleanup entrypoint for in-memory hub references.
- `releaseAllLeases()` performs best-effort telemetry flush and stops hub monitors during shutdown.

References: `apps/gateway/src/hub/hub-manager.ts`, `apps/gateway/src/server.ts`

### Session Ownership + Runtime Leases
Redis leases coordinate multi-instance safety.

- Owner lease key: `lease:owner:{sessionId}` (30s TTL). Required for runtime lifecycle authority.
- Runtime lease key: `lease:runtime:{sessionId}` (20s TTL). Used for liveness/orphan detection.
- Owner renewals use Lua check-and-extend to avoid race conditions.
- Lease cleanup is owner-aware; hubs that never owned must not clear shared runtime lease state.

References: `apps/gateway/src/lib/session-leases.ts`, `apps/gateway/src/hub/session-hub.ts`

### Split-Brain Lag Guard
Lease renewal is event-loop-sensitive.

- If renewal lag exceeds owner lease TTL, hub self-terminates to avoid split-brain execution.
- Self-termination drops clients, stops migration/idle monitors, disconnects SSE, and evicts hub.

Reference: `apps/gateway/src/hub/session-hub.ts`

### Runtime Boundary
`SessionRuntime` owns the actual runtime state machine.

- Single-flight `ensureRuntimeReady()` coalesces concurrent callers.
- Context is reloaded from DB on readiness attempts.
- Runtime waits migration lock release (unless skip flag during controlled migration re-init).
- Runtime always goes through provider abstraction (`ensureSandbox`) instead of direct create calls.

Reference: `apps/gateway/src/hub/session-runtime.ts`

### Session Creation Paths
There are two intentional creation paths.

- Gateway HTTP (`POST /proliferate/sessions`): configuration resolution, optional immediate sandbox, integration/session connections, Redis idempotency envelope.
- Web oRPC (`sessions.create`): lightweight DB-centric path (including scratch sessions) that may trigger eager-start asynchronously.

References: `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions-create.ts`

### SSE Bridge
SSE is transport-only and unidirectional.

- Gateway connects to sandbox `GET /event` and parses events with `eventsource-parser`.
- Hub owns reconnect strategy and policy; `SseClient` does not reconnect on its own.
- Heartbeat/read timeout failures map to disconnect reasons that drive hub reconnect logic.

References: `apps/gateway/src/hub/sse-client.ts`, `apps/gateway/src/hub/session-hub.ts`

### Migration + Idle + Orphan Recovery
Migration and cleanup are lock/fencing-driven.

- Expiry jobs are scheduled with BullMQ using `expiresAt - GRACE_MS` delay.
- Migration and idle snapshot flows are protected by distributed migration lock.
- Idle/orphan writes fence against stale sandbox IDs via CAS update methods.
- Orphan sweeper is DB-first and runtime-lease-based, so recovery works post-restart with empty hub map.

References: `apps/gateway/src/expiry/expiry-queue.ts`, `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`

### Gateway-Intercepted Tool Callbacks
Intercepted tools execute through HTTP callbacks, not SSE interception.

- Route: `POST /proliferate/:sessionId/tools/:toolName`.
- Auth source must be sandbox HMAC token.
- Idempotency is per-process (`inflightCalls` + `completedResults` cache with retention).

References: `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`

---

## 5. Conventions & Patterns

### Do
- Obtain hubs via `hubManager.getOrCreate()` only.
- Treat `SessionHub.ensureRuntimeReady()` as the lifecycle gate for runtime availability.
- Use `createSyncClient()` for programmatic gateway access.
- Use `GIT_READONLY_ENV` for read-only git operations to avoid index lock contention.

### Don't
- Do not route real-time tokens through Next.js API routes.
- Do not trust caller-supplied `userId` in WS/HTTP prompt payloads when auth already establishes identity.
- Do not call provider sandbox creation primitives directly from hub lifecycle code; use runtime/provider orchestration entrypoints.
- Do not mutate session state on snapshot/migration paths without lock + CAS safeguards.

### Error Handling
- Route-level operational failures should throw `ApiError` for explicit status and details.
- Billing gate failures map to 402 via `BillingGateError` handling.
- Unknown/unexpected exceptions are logged and returned as 500.

Reference: `apps/gateway/src/middleware/error-handler.ts`

### Reliability
- Owner/runtime lease heartbeat prevents split-brain and drives orphan detection.
- Runtime readiness is single-flight and migration-lock-aware.
- SSE has explicit read timeout and heartbeat timeout detection.
- Reconnect uses configured delay series (`[1000, 2000, 5000, 10000, 30000]` by default).
- Initial prompt send has in-memory and DB marker guards with rollback-on-failure semantics.
- Expiry is durable via BullMQ delayed jobs; stale jobs are cancelled during pause/cleanup flows.
- Idle snapshot failure circuit-breaker force-terminates after repeated failures to prevent runaway spend.

References: `apps/gateway/src/lib/env.ts`, `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/expiry/expiry-queue.ts`, `apps/gateway/src/hub/migration-controller.ts`

### Testing Conventions
- Colocate gateway tests near source.
- Mock sandbox providers and lease/tool dependencies for deterministic lifecycle tests.
- Validate lease ordering and prompt idempotency behaviors explicitly (existing test patterns).

References: `apps/gateway/src/hub/session-hub.test.ts`, `apps/gateway/src/api/proliferate/ws/ws-handler.test.ts`, `apps/gateway/src/hub/session-telemetry.test.ts`

---

## 6. Subsystem Deep Dives (Invariants & Rules)

### 6.1 Session Creation Invariants — `Implemented`
- Gateway session creation must receive exactly one configuration source (`configurationId`, `managedConfiguration`, or `cliConfiguration`).
- Session admission must enforce plan-based concurrent limits atomically when billing limits exist.
- Idempotent create/prompt behavior at gateway HTTP edge is Redis-backed (`Idempotency-Key` reservation + replay), not DB-constraint-backed.
- Deferred creation must return without sandbox provisioning; immediate mode must persist running sandbox metadata or clean up failed records.
- oRPC session creation must remain a metadata-first path that can trigger eager-start but does not synchronously provision sandboxes.
- Scratch sessions must have `configurationId: null` and use scratch prompt/context semantics.

References: `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions-create.ts`, `packages/services/src/sessions/db.ts`

### 6.2 Runtime Ownership & Readiness Invariants — `Implemented`
- Hub runtime readiness must acquire owner lease before invoking runtime lifecycle work.
- Failure to acquire owner lease must fail fast and block provisioning.
- Runtime readiness must be idempotent per hub instance via single-flight promise coalescing.
- Runtime readiness must reload DB session context before provisioning/recovery decisions.
- Runtime readiness must enforce billing resume gate before cold-start/resume.
- Runtime readiness must set/renew runtime lease once runtime is active.
- Runtime init failure must release ownership (no zombie owner lease retention).

References: `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/lib/session-leases.ts`

### 6.3 Event Pipeline Invariants — `Implemented`
- Event processor must be a transform layer only; tool side effects do not execute in this path.
- Events from non-matching OpenCode session IDs must be ignored.
- User-message text parts must not be echoed as assistant tokens.
- Assistant message creation must happen exactly once per turn context.
- `message_complete` must not emit while any tool state is still running.
- Tool lifecycle events must be deduplicated by part/tool call identity.

Reference: `apps/gateway/src/hub/event-processor.ts`

### 6.4 Session Telemetry Invariants — `Implemented`
- Telemetry accumulation is hub-local and in-memory; DB is eventual via flushes.
- Tool call counts must deduplicate by `toolCallId`.
- PR URL aggregation must deduplicate both within flush windows and across session lifetime in memory.
- Flush must be single-flight and differential: flushing one snapshot cannot erase increments recorded during that flush.
- Flush sites must be best-effort and include runtime teardown paths (idle, expiry, automation termination, graceful shutdown).

References: `apps/gateway/src/hub/session-telemetry.ts`, `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/hub/migration-controller.ts`, `packages/services/src/sessions/db.ts`

### 6.5 WebSocket + HTTP Protocol Invariants — `Implemented`
- WS auth must require valid token (`?token=` or bearer header) before upgrade completion.
- Client connection initialization must emit `status: resuming` before runtime readiness completion and `init` payload.
- Prompt/cancel handling must require authenticated user context; mismatched claimed user IDs are ignored.
- Git mutation operations must enforce session mutation auth (`created_by` match unless headless session).
- `ensureSessionReady` middleware must gate routes that require active runtime (`info`, `message`, `cancel`, most proxies).
- Tool callbacks, actions, eager-start, and heartbeat must remain callable without forcing runtime boot through `ensureSessionReady`.

References: `apps/gateway/src/api/proliferate/ws/index.ts`, `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/api/proliferate/http/index.ts`, `apps/gateway/src/middleware/lifecycle.ts`

### 6.6 Migration, Idle Snapshot, and Orphan Recovery Invariants — `Implemented`
- All migration/snapshot transitions must execute under distributed migration lock.
- Idle snapshot must re-check idle predicate inside the lock before mutating runtime/DB.
- Idle/expiry/orphan state writes must fence on expected sandbox ID (CAS) to avoid stale writers.
- Snapshot strategy must prefer memory snapshot when available, then provider pause, then filesystem snapshot fallback.
- Repeated idle snapshot failures must trip a circuit breaker and force-terminate.
- Orphan sweeper must scan DB running sessions and rely on runtime lease existence, not hub presence.

References: `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`, `packages/services/src/sessions/db.ts`, `apps/gateway/src/expiry/expiry-queue.ts`

### 6.7 Git Operations Invariants — `Implemented`
- All git/gh commands must run non-interactively.
- Read-only git status paths must use optional-lock avoidance env to reduce contention.
- Workspace paths must be constrained to sandbox workspace root.
- Git action result mapping must normalize common failure classes to stable result codes.

Reference: `apps/gateway/src/hub/git-operations.ts`

### 6.8 Proxy and Devtools Invariants — `Implemented`
- Proxy routes must authenticate via path token (`/proxy/:sessionId/:token/...`).
- Proxy routes that need live sandbox targets must require session readiness before proxying.
- Devtools/VSCode/terminal upstream auth must use gateway-derived sandbox-mcp token, not caller token passthrough.
- Terminal/VSCode WS proxy connections must participate in hub activity tracking so idle snapshot does not race active proxy users.

References: `apps/gateway/src/api/proxy/opencode.ts`, `apps/gateway/src/api/proxy/devtools.ts`, `apps/gateway/src/api/proxy/terminal.ts`, `apps/gateway/src/api/proxy/vscode.ts`

### 6.9 Gateway Client Library Invariants — `Implemented`
- Sync client must target `/proliferate/*` HTTP routes and `/proliferate/:sessionId` WS route.
- WS client reconnect defaults must be bounded and exponential.
- HTTP helpers must support idempotency headers for create/prompt calls.

References: `packages/gateway-clients/src/clients/sync/http.ts`, `packages/gateway-clients/src/clients/sync/websocket.ts`, `packages/gateway-clients/src/clients/sync/index.ts`

### 6.10 Session UI Surface Invariants — `Implemented`
- Display status must derive from shared session status mapping, not ad hoc UI heuristics.
- Session context lines must prioritize `latestTask` with fallback to prompt snippets where applicable.
- Session summaries must render through sanitized markdown path only.
- Peek drawer state must be URL-routable (`?peek=<sessionId>`) and preserve session selection on refresh.
- Telemetry (`metrics`, PR counts, outcomes) must be consistently represented across sessions and inbox run triage surfaces.

References: `apps/web/src/components/sessions/session-card.tsx`, `apps/web/src/components/sessions/session-peek-drawer.tsx`, `apps/web/src/components/ui/sanitized-markdown.tsx`, `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`, `apps/web/src/components/inbox/inbox-item.tsx`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sandbox-providers.md` | This → Provider | `ensureSandbox`, `snapshot`, `pause`, `terminate`, `memorySnapshot` | Runtime and migration delegate all sandbox lifecycle operations via provider abstraction |
| `agent-contract.md` | This → Tool contract | `/proliferate/:sessionId/tools/:toolName` | Gateway-intercepted tools execute through synchronous HTTP callbacks |
| `automations-runs.md` | Runs → This | `createSyncClient().createSession/postMessage` | Automation worker bootstraps sessions through gateway client contracts |
| `actions.md` | Shared surface | `/proliferate/:sessionId/actions/*` | Action invocation and approval lifecycle references session context and hub broadcast |
| `repos-prebuilds.md` | This → Config | `resolveConfiguration`, configuration repo/service command APIs | Gateway creation/runtime path depends on configuration resolution outputs |
| `secrets-environment.md` | This ← Secrets | `sessions.buildSandboxEnvVars`, configuration env file spec | Session runtime/build paths hydrate env vars and file instructions from services |
| `integrations.md` | This ↔ Integrations | repo/session connection token resolution | Gateway/session-store resolve git + provider tokens through integration services |
| `billing-metering.md` | This ↔ Billing | `assertBillingGateForOrg`, `checkBillingGateForOrg`, billing columns | Creation and resume are gate-protected; telemetry/status feed metering lifecycle |

### Security & Auth
- Auth sources supported by gateway: user JWT, service JWT, sandbox HMAC token, CLI API key.
- Proxy auth uses path token because some clients cannot attach headers for upgrade/streaming paths.
- Sandbox callback/tool routes require sandbox auth source explicitly.
- Session mutation operations guard against unauthorized user mutation even after connection auth.

References: `apps/gateway/src/middleware/auth.ts`, `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/session-hub.ts`

### Observability
- Structured logs are namespaced by gateway module (`hub`, `runtime`, `migration`, `sse-client`, etc.).
- Runtime readiness logs latency breakdown for major lifecycle stages.
- HTTP layer uses request logging via `pino-http` wrapper.

References: `apps/gateway/src/server.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/hub/sse-client.ts`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tests pass (`pnpm -C apps/gateway test`)
- [ ] Gateway client tests pass (`pnpm -C packages/gateway-clients test`)
- [ ] Deep Dives section is invariant-based (no imperative step-runbooks)
- [ ] Legacy "File Tree" and "Data Models" sections are removed from this spec

---

## 9. Known Limitations & Tech Debt

- [ ] **Hub memory growth is lifecycle-driven, not cap-driven** — current `HubManager` has no explicit hard-cap/LRU policy; cleanup depends on hub lifecycle callbacks and shutdown.
- [ ] **Expiry migration trigger is queue-driven** — there is no separate in-process precise expiry timer in current gateway runtime path.
- [ ] **Tool callback idempotency is process-local** — duplicate callbacks routed to different pods can bypass in-memory dedup.
- [ ] **Session create idempotency is Redis path-dependent** — `sessions.idempotency_key` exists in schema but is not the active enforcement path in gateway creation.
- [ ] **Dual session creation pipelines remain** — gateway HTTP and web oRPC creation are still separate behavioral paths.
- [ ] **GitHub token resolution logic is duplicated** — similar selection logic exists in both `session-store.ts` and `session-creator.ts`.
- [ ] **No durable chat transcript persistence in gateway/session DB path** — message history continuity depends on sandbox/OpenCode continuity.
- [ ] **CORS is permissive (`*`)** — production hardening still depends on token controls rather than origin restrictions.
- [ ] **Session status remains a text column in DB** — invalid status writes are possible without DB enum/check constraints.
