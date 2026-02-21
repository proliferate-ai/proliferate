# Sandbox Providers — System Spec

## 1. Scope & Purpose

### In Scope
- `SandboxProvider` interface contract and capability flags
- Provider factory selection (`modal` vs `e2b`)
- Modal provider implementation (`ModalLibmodalProvider`)
- E2B provider implementation (`E2BProvider`)
- Sandbox boot orchestration (workspace clone/restore, tool injection, OpenCode startup)
- Snapshot behavior (filesystem snapshot, pause snapshot, memory snapshot)
- Git freshness on restore (`shouldPullOnRestore` + provider integrations)
- Base snapshot version key + Modal base/configuration snapshot build paths
- sandbox-mcp sidecar (`api-server`, terminal WS, service manager, in-sandbox CLI)
- Sandbox auth token wiring (`SANDBOX_MCP_AUTH_TOKEN`)
- Caddy preview/proxy integration (`/_proliferate/mcp/*`, `/_proliferate/vscode/*`)

### Out of Scope
- Session lifecycle orchestration, hub ownership, SSE runtime state machine — see `sessions-gateway.md`
- Tool schemas/prompts and interception semantics — see `agent-contract.md`
- Configuration lifecycle and snapshot build triggering policy — see `repos-prebuilds.md`
- Secret CRUD and bundle lifecycle — see `secrets-environment.md`
- LLM proxy key issuance/routing policy — see `llm-proxy.md`

### Mental Models

A sandbox provider is a compute orchestration adapter, not a session orchestrator. Session code decides *when* to create, resume, pause, or terminate; provider code decides *how* that action is executed against Modal or E2B.

The core abstraction is capability-based, not provider-uniform:
- Filesystem snapshot exists on both providers.
- Pause/resume exists only on E2B (`supportsPause`, `supportsAutoPause`).
- Memory snapshot exists only on Modal (`supportsMemorySnapshot`, `memorySnapshot`, `restoreFromMemorySnapshot`).

Every sandbox has two control planes:
- OpenCode plane on port `4096` for agent interaction.
- sandbox-mcp plane on port `4000` for terminal/services/git inspection, fronted by Caddy on preview port `20000`.

Boot is intentionally split into two phases:
- Essential phase (blocking): required for a usable agent session.
- Additional phase (async): improves runtime ergonomics but should not block session readiness.

State is intentionally split:
- Durable session metadata in DB (`sessions` row and linked records).
- In-sandbox operational metadata at `/home/user/.proliferate/metadata.json`.
- Provider instances themselves are ephemeral/stateless across calls.

### Things Agents Get Wrong

- `ensureSandbox()` is the default lifecycle entry point; `createSandbox()` is for explicit fresh creation only (`packages/shared/src/sandbox-provider.ts`, `packages/shared/src/providers/*.ts`).
- Modal and E2B use different identity primitives for recovery:
  - Modal finds by sandbox name = `sessionId` (`fromName`).
  - E2B finds by stored `currentSandboxId` (`Sandbox.getInfo`) (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- Memory snapshot IDs are prefixed `mem:` and only Modal can restore them (`restoreFromMemorySnapshot`) (`packages/shared/src/providers/modal-libmodal.ts`).
- Snapshot resolution utility no longer does repo-level fallback; it is configuration snapshot or `null` only (`packages/shared/src/snapshot-resolution.ts`).
- Setup-only tools are session-type gated; they are injected for `setup` sessions and explicitly removed for non-setup restores (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- `PLUGIN_MJS` logs execute inside sandbox runtime, not in provider process (`packages/shared/src/sandbox/config.ts`).
- `checkSandboxes()` must be side-effect free; E2B must not use `Sandbox.connect()` there (`packages/shared/src/providers/provider-contract.test.ts`, `packages/shared/src/providers/e2b.ts`).
- Snapshot restore freshness is cadence-gated and metadata-aware; cadence advances only when all pulls succeed (`packages/shared/src/sandbox/git-freshness.ts`, `packages/shared/src/providers/pull-on-restore.test.ts`).
- Gateway callback tools (`verify`, `save_snapshot`, etc.) require `PROLIFERATE_GATEWAY_URL`, `PROLIFERATE_SESSION_ID`, and `SANDBOX_MCP_AUTH_TOKEN` in sandbox env (`packages/shared/src/opencode-tools/index.ts`).
- Direct provider instantiation is valid for snapshot workers, not for session runtime code paths (`apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`, `packages/shared/src/providers/index.ts`).

---

## 2. Core Concepts

### Provider Factory
`getSandboxProvider(type?)` resolves provider implementation from explicit type or `DEFAULT_SANDBOX_PROVIDER` and returns a fresh provider instance (`packages/shared/src/providers/index.ts`).

Session runtime persists and reuses provider type via `sessions.sandbox_provider` to keep resume/snapshot behavior provider-consistent (`apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/hub/session-hub.ts`).

### SandboxProvider Contract
`SandboxProvider` defines required lifecycle methods plus optional capability methods (`checkSandboxes`, `resolveTunnels`, `execCommand`, memory snapshot methods) (`packages/shared/src/sandbox-provider.ts`).

Capability flags are authoritative:
- `supportsPause` / `supportsAutoPause` (E2B)
- `supportsMemorySnapshot` (Modal)

Callers must branch on capabilities rather than assuming parity.

### Snapshot Surfaces
Current snapshot surfaces in active runtime flow:
- Configuration/session snapshot IDs (plain string IDs)
- Pause snapshots (E2B: snapshot ID equals sandbox ID)
- Memory snapshots (Modal: `mem:<id>`)
- Base snapshots for cold-start acceleration (Modal only)

`resolveSnapshotId()` is intentionally a pure utility with simple semantics: return `configurationSnapshotId` if present, else `null` (`packages/shared/src/snapshot-resolution.ts`).

### OpenCode + Model Configuration
Canonical model IDs live in `agents.ts`, and providers convert to OpenCode model IDs via `toOpencodeModelId()` (`packages/shared/src/agents.ts`).

Default model is `claude-sonnet-4.6` (not Opus) (`packages/shared/src/agents.ts`).

OpenCode config and readiness are shared utilities (`getOpencodeConfig`, `waitForOpenCodeReady`) used by both providers (`packages/shared/src/sandbox/opencode.ts`).

### Metadata + Freshness
Providers maintain `SessionMetadata` in `/home/user/.proliferate/metadata.json` for repo directory and freshness cadence tracking (`packages/shared/src/sandbox/opencode.ts`, `packages/shared/src/providers/*.ts`).

`shouldPullOnRestore()` is the shared policy function. Providers own actual git credential rewrite/pull execution and metadata timestamp updates (`packages/shared/src/sandbox/git-freshness.ts`).

### sandbox-mcp Sidecar
sandbox-mcp provides in-sandbox HTTP/WS APIs for service management, terminal access, and git introspection (`packages/sandbox-mcp/src/index.ts`, `packages/sandbox-mcp/src/api-server.ts`, `packages/sandbox-mcp/src/terminal.ts`).

It is reachable externally through Caddy’s `/_proliferate/mcp/*` path (`packages/shared/src/sandbox/config.ts`).

---

## 5. Conventions & Patterns

### Do
- Use `getSandboxProvider()` for runtime selection in gateway/session code.
- Use `ensureSandbox()` for runtime bootstrap/recovery.
- Gate provider-specific behavior with capability flags (`supportsPause`, `supportsMemorySnapshot`).
- Pass callback/auth env vars whenever sandbox tools/services depend on gateway callbacks.
- Use `shellEscape()` for shell-interpolated values and `capOutput()` for logged command output.
- Wrap/normalize provider errors via `SandboxProviderError`.
- Treat provider `terminate()` as idempotent and tolerant of not-found.

### Don’t
- Don’t assume snapshot IDs are interchangeable across providers.
- Don’t call `Sandbox.connect()` in `checkSandboxes()` (side effects on paused E2B sandboxes).
- Don’t log raw secrets or unredacted provider errors.
- Don’t expose setup-only tools in non-setup sessions.
- Don’t block session readiness on async additional dependency setup.

### Reliability Notes
- OpenCode readiness probes are bounded and best-effort on create; runtime recovery should tolerate transient failure and reconnect (`packages/shared/src/sandbox/opencode.ts`, `packages/shared/src/providers/*.ts`).
- sandbox-mcp CLI retries transient local API connection errors (`packages/sandbox-mcp/src/proliferate-cli.ts`).

---

## 6. Subsystem Deep Dives (Declarative Invariants)

### 6.1 Provider Selection Invariants — `Implemented`
- Provider choice for a session must be stable after session creation (`sessions.sandbox_provider`).
- `getSandboxProvider()` must fail fast on unknown/missing provider type.
- Session-facing runtime code must call providers through the factory.
- Direct class instantiation is permitted only in provider-specific build/ops paths (base/config snapshot workers, snapshot CLI).

References: `packages/shared/src/providers/index.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`.

### 6.2 Lifecycle Entry Invariants — `Implemented`
- `ensureSandbox()` must preserve recovery-first semantics: reuse live sandbox when possible, otherwise create.
- Recovery must return fresh tunnel/preview endpoints via `resolveTunnels()`.
- Provider-level state must not be required between calls; only DB and sandbox filesystem state are authoritative.

References: `packages/shared/src/sandbox-provider.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`.

### 6.3 Modal Provider Invariants — `Implemented`
- Modal declares `supportsPause=false`, `supportsAutoPause=false`, `supportsMemorySnapshot=true`.
- Modal image selection precedence is invariant:
  - restore snapshot (`opts.snapshotId`) first
  - base snapshot (`opts.baseSnapshotId` or `MODAL_BASE_SNAPSHOT_ID`) second
  - `get_image_id` fallback last
- Modal memory snapshots must round-trip through `mem:` ID prefix and `restoreFromMemorySnapshot()`.
- Memory restore must not return control before OpenCode readiness succeeds.
- `pause()` must always fail with explicit unsupported error.

References: `packages/shared/src/providers/modal-libmodal.ts`, `packages/modal-sandbox/deploy.py`.

### 6.4 E2B Provider Invariants — `Implemented`
- E2B declares `supportsPause=true`, `supportsAutoPause=true`.
- E2B snapshot semantics are pause semantics (`snapshot()` delegates to `pause()`, snapshot ID = sandbox ID).
- E2B resume path (`Sandbox.connect(snapshotId)`) is allowed to fall back to fresh create on failure.
- `checkSandboxes()` must use listing APIs only and remain side-effect free.

References: `packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/provider-contract.test.ts`.

### 6.5 Boot Pipeline Invariants — `Implemented`
- Essential boot work must complete before `createSandbox()` resolves:
  - workspace clone/restore resolution
  - OpenCode config + plugin + tools/instructions/actions-guide writes
  - OpenCode process launch
- Additional boot work runs async and must not fail session creation:
  - start infra services
  - Caddy startup
  - sandbox-mcp startup
  - env apply + service autostart bootstrapping
- Setup-only tools (`save_service_commands`, `save_env_files`) are only present in setup sessions.
- Non-setup sessions must proactively remove setup-only tools when restoring from setup snapshots.

References: `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`, `packages/shared/src/opencode-tools/index.ts`.

### 6.6 Service Boot + Env File Invariants — `Implemented`
- Env files must be applied before tracked service autostart commands run.
- Service autostart requires both `snapshotHasDeps=true` and non-empty resolved service commands.
- Services started via `proliferate services start` are expected to be tracked by service-manager state/log APIs.

References: `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`, `packages/sandbox-mcp/src/proliferate-cli.ts`, `packages/sandbox-mcp/src/service-manager.ts`.

### 6.7 Freshness Invariants — `Implemented`
- Pull-on-restore must be policy-driven (`SANDBOX_GIT_PULL_ON_RESTORE`, cadence, snapshot presence, repo count).
- Providers must refresh git credentials before pull attempts when pull policy is active.
- `lastGitFetchAt` may advance only when all repo pulls succeed.
- Pull failures must be non-fatal to sandbox restore/startup.

References: `packages/shared/src/sandbox/git-freshness.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/pull-on-restore.test.ts`.

### 6.8 Snapshot Resolution Invariants — `Implemented`
- `resolveSnapshotId()` must never invent provider-specific fallback IDs.
- If `configurationSnapshotId` exists, return it.
- If absent, return `null`.

References: `packages/shared/src/snapshot-resolution.ts`, `packages/shared/src/snapshot-resolution.test.ts`.

### 6.9 sandbox-mcp API Invariants — `Implemented`
- HTTP API listens on port `4000`; terminal WS endpoint is `/api/terminal`.
- All endpoints except `/api/health` require bearer auth token validation.
- Git endpoints must constrain repo/file paths to workspace boundaries.
- Git diff responses must be capped to prevent oversized payloads.

References: `packages/sandbox-mcp/src/index.ts`, `packages/sandbox-mcp/src/api-server.ts`, `packages/sandbox-mcp/src/terminal.ts`, `packages/sandbox-mcp/src/auth.ts`.

### 6.10 Service Manager Invariants — `Implemented`
- Service state is persisted in `/tmp/proliferate/state.json`; logs in `/tmp/proliferate/logs/`.
- Starting a service with an existing name must replace prior process ownership.
- Process group termination semantics must be used when possible to avoid orphan children.
- Exposed port routing must be written to `/home/user/.proliferate/caddy/user.caddy` and reloaded via Caddy signal.

References: `packages/sandbox-mcp/src/service-manager.ts`, `packages/shared/src/sandbox/config.ts`.

### 6.11 Proliferate CLI Invariants — `Implemented`
- `services` commands are sandbox-mcp API clients and require auth token.
- `env apply` is two-pass (validate then write) and path-constrained to workspace.
- `env scrub` removes secret-mode files and local override file.
- `actions` commands call gateway APIs and must support approval-polling flow.

References: `packages/sandbox-mcp/src/proliferate-cli.ts`, `packages/sandbox-mcp/src/proliferate-cli-env.test.ts`, `packages/sandbox-mcp/src/actions-grants.ts`.

### 6.12 Base + Configuration Snapshot Build Invariants — `Implemented`
- Base snapshot version key must deterministically hash runtime-baked files/config + image version salt.
- Base snapshot builds are Modal-only and run out-of-band (worker/ops scripts), not in session request path.
- Configuration snapshot builds are Modal-only; non-Modal configurations are marked default/no-snapshot.

References: `packages/shared/src/sandbox/version-key.ts`, `apps/worker/src/base-snapshots/index.ts`, `apps/worker/src/configuration-snapshots/index.ts`, `apps/gateway/src/bin/create-modal-base-snapshot.ts`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions/Gateway runtime | Gateway -> Provider | `ensureSandbox`, `snapshot`, `pause`, `terminate`, `execCommand` | Runtime lifecycle orchestration belongs to `sessions-gateway.md`; providers execute compute operations. |
| Agent tooling | Provider -> Sandbox FS | `.opencode/tool/*`, plugin file, instructions | Tool schemas/behavior are owned by `agent-contract.md`; providers only inject runtime artifacts. |
| Repos/Configurations | Workers -> Modal provider | `createBaseSnapshot`, `createConfigurationSnapshot` | Build scheduling/ownership is in `repos-prebuilds.md`. |
| Secrets/Environment | Services/Gateway -> Provider | `CreateSandboxOpts.envVars`, env files spec | Secret CRUD and schema ownership is in `secrets-environment.md`. |
| LLM proxy | Services -> Provider/Sandbox | `LLM_PROXY_API_KEY`, `ANTHROPIC_BASE_URL` | Key issuance/routing policy is in `llm-proxy.md`. |
| Actions | sandbox CLI -> Gateway | `/proliferate/:sessionId/actions/*` | Approval/risk/grants logic is in `actions.md`; provider responsibility is env wiring and CLI availability. |

### Security & Auth
- sandbox-mcp auth is bearer-token based and deny-by-default when token is absent (`packages/sandbox-mcp/src/auth.ts`).
- Gateway derives per-session sandbox token via HMAC and uses it when proxying terminal/devtools flows (`apps/gateway/src/lib/sandbox-mcp-token.ts`, `apps/gateway/src/api/proxy/terminal.ts`).
- Provider error surfaces must redact secrets via `SandboxProviderError` and `redactSecrets()` (`packages/shared/src/sandbox/errors.ts`).
- Snapshot save flow scrubs secret env files before snapshot and reapplies afterward (`apps/gateway/src/hub/session-hub.ts`).

### Observability
- Providers emit structured latency markers across critical lifecycle edges (`provider.*` events) (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- sandbox-mcp logs via service-scoped logger for API/terminal components (`packages/sandbox-mcp/src/api-server.ts`, `packages/sandbox-mcp/src/terminal.ts`).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Shared/provider tests pass (`pnpm -C packages/shared test`)
- [ ] sandbox-mcp tests pass (`pnpm -C packages/sandbox-mcp test`)
- [ ] This spec removes sectioned file-tree/data-model inventories and keeps deep dives declarative
- [ ] No spec statements conflict with provider capabilities (`supportsPause`, `supportsMemorySnapshot`) in code

---

## 9. Known Limitations & Tech Debt

- [ ] **Modal pause is unsupported** — Modal sessions cannot use native pause semantics and rely on snapshot + recreate paths (`packages/shared/src/providers/modal-libmodal.ts`).
- [ ] **E2B resume fallback is silent** — failed `Sandbox.connect(snapshotId)` falls back to fresh sandbox creation without user-visible warning (`packages/shared/src/providers/e2b.ts`).
- [ ] **Immediate sandbox creation path does not inject gateway callback env vars by default** — `session-creator` direct `provider.createSandbox()` path omits `SANDBOX_MCP_AUTH_TOKEN`, `PROLIFERATE_GATEWAY_URL`, and `PROLIFERATE_SESSION_ID`, while tool callbacks/sandbox-mcp auth depend on them (`apps/gateway/src/lib/session-creator.ts`, `apps/gateway/src/hub/session-runtime.ts`, `packages/shared/src/opencode-tools/index.ts`, `packages/shared/src/providers/*.ts`).
- [ ] **Freshness logic is duplicated across layers** — providers run cadence-aware pull-on-restore, and runtime also runs a best-effort pull from `/home/user/workspace`; this creates overlap and uneven multi-repo behavior (`packages/shared/src/providers/*.ts`, `apps/gateway/src/hub/session-runtime.ts`).
- [ ] **E2B setup parity gap** — E2B provider currently does not write SSH authorized keys or trigger context files, unlike Modal (`packages/shared/src/providers/e2b.ts`, `packages/shared/src/providers/modal-libmodal.ts`).
- [ ] **`resolveSnapshotId()` is currently not on the primary session-start path** — runtime/session-creator consume snapshot IDs directly from resolved configuration/session state, leaving this utility as a pure helper/test surface (`packages/shared/src/snapshot-resolution.ts`, `apps/gateway/src/lib/configuration-resolver.ts`, `apps/gateway/src/lib/session-creator.ts`).
- [ ] **Setup-only tool cleanup is reactive** — non-setup sessions remove setup-only tools during restore instead of pre-snapshot scrubbing (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- [ ] **sandbox-mcp/service processes are fire-and-forget** — no built-in supervisor for OpenCode, Caddy, or sandbox-mcp after provider startup (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- [ ] **Service-manager state is `/tmp`-backed** — persistence characteristics differ across provider lifecycle semantics and are not durable across fresh sandbox recreation (`packages/sandbox-mcp/src/service-manager.ts`).
