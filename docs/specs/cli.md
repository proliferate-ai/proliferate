# CLI — System Spec

## 1. Scope & Purpose

### In Scope
- CLI runtime behavior (`proliferate`, `proliferate reset`, `--help`, `--version`)
- Device authentication lifecycle and token persistence
- Local state and config management under `~/.proliferate/`
- SSH key lifecycle (generate, reuse, upload public key)
- Gateway-native session creation and OpenCode attach
- Local-to-sandbox file sync semantics
- CLI-related service/router behavior used by auth, session metadata, and GitHub selection
- **Command mode**: Namespace commands for sandbox control-plane operations (session, manager, source, action, baseline)
- **JSON envelope contract**: Standardized response format for all command-mode operations
- **Exit code contract**: Differentiated exit codes mapped to error classes
- **Auth refresh**: Env-var based token with single retry on 401

### Out of Scope
- Gateway runtime internals after session creation (`sessions-gateway.md`)
- Sandbox provider boot internals (`sandbox-providers.md`)
- Global auth internals and key revocation UX (`auth-orgs.md`)
- Billing policy design (`billing-metering.md`)
- Nango/provider lifecycle outside CLI-specific handoff (`integrations.md`)
- Daemon-mediated IPC token refresh (deferred to Phase B, PR 24)

### Mental Models
- The CLI is an orchestrator, not a platform. It coordinates existing systems and exits.
- The CLI has two modes: **interactive** (auth → session → sync → OpenCode) and **command** (namespace commands for sandbox use).
- The authoritative runtime path is gateway-native for session creation and attach (`@proliferate/gateway-clients`).
- Command mode is the canonical sandbox control-plane interface. Manager tools and coding harness operations route through it.
- Device auth is a two-phase handshake: browser authorization marks state; poll completion mints the API key.
- `localPathHash` is device-scoped identity for a workspace, not a global repo identity.
- Sync is intentionally one-way (local -> sandbox) and best-effort relative to session startup.
- All command-mode responses use the JSON envelope format. Interactive mode uses human-readable output (chalk/spinners).

### Things Agents Get Wrong
- Assuming API routes are in the streaming path. They are not; real-time flows are gateway-based.
- Assuming `/api/cli/*` routes are fully absent. This repo now provides compatibility handlers for `/api/cli/sessions`, `/api/cli/auth/device`, `/api/cli/auth/device/poll`, and `/api/cli/ssh-keys`, while broader CLI logic still lives under oRPC.
- Assuming device authorization itself creates the token. Token creation happens in poll completion (`pollDevice`).
- Assuming `hashLocalPath()` is the correct identifier for CLI sessions. Runtime uses `hashPrebuildPath()` (device-scoped).
- Assuming config precedence is env-over-file. `getConfig()` currently resolves `apiUrl` as file override first, then env/default.
- Assuming CLI session listings reflect gateway-created CLI sessions without drift. Legacy query filters still expect `session_type = "terminal"`.
- Assuming sync failure is fatal. Current runtime warns and continues.
- Assuming the CLI supports Windows. It exits early with a WSL2 recommendation.
- Assuming command-mode output is human-readable. All command output is JSON envelope to stdout.
- Assuming exit code 1 means error. CLI uses differentiated codes: 2=validation, 3=policy denied, 4=approval required, 5=retryable, 6=terminal.

---

## 2. Core Concepts

### 2.1 Device Auth Contract
- Device codes are short-lived, single-purpose records.
- User interaction happens on `/device`; CLI polling remains the source of completion for token issuance.
- Poll completion mints a better-auth API key and clears the consumed device-code row.
- Auth state is local-first and reused until health check fails.

Reference points:
- `packages/cli/src/state/auth.ts`
- `apps/web/src/server/routers/cli.ts` (`cliAuthRouter`)
- `packages/services/src/cli/service.ts`

### 2.2 Gateway-Native Session Contract
- CLI runtime creates sessions through `createSyncClient().createSession()` against gateway.
- `sessionType` and `clientType` are both explicitly `cli`.
- SSH-enabled CLI flows require immediate sandbox readiness (enforced in gateway session creator).
- Attach URL generation for OpenCode is a gateway proxy URL derived from token + session ID.

Reference points:
- `packages/cli/src/main.ts`
- `packages/gateway-clients/src/clients/sync/index.ts`
- `packages/gateway-clients/src/clients/external/opencode.ts`
- `apps/gateway/src/lib/session-creator.ts`

### 2.3 Device-Scoped Workspace Identity
- Workspace identity is derived from `{deviceId}::{path}` and hashed.
- Same path on different machines should not collide.
- Device ID persistence is local and stable after first generation.

Reference points:
- `packages/cli/src/lib/device.ts`
- `packages/cli/src/lib/ssh.ts`

### 2.4 Local State Security Baseline
- `~/.proliferate/` is created with restrictive directory permissions.
- Token/config/device-id writes are permissioned for single-user access.
- SSH private keys never leave the local machine.

Reference points:
- `packages/cli/src/state/config.ts`
- `packages/cli/src/state/auth.ts`
- `packages/cli/src/lib/ssh.ts`

### 2.5 API Surface Split
- CLI runtime currently mixes gateway HTTP, compatibility REST-style endpoints (`/api/cli/auth/*`, `/api/cli/ssh-keys`), and oRPC-backed server logic.
- oRPC is the authoritative router surface in web app code.
- Standalone compatibility routes bridge legacy CLI contracts while backend business logic remains service/oRPC-driven.

Reference points:
- `packages/cli/src/state/auth.ts`
- `apps/web/src/app/api/cli/sessions/route.ts`
- `apps/web/src/app/api/rpc/[[...rest]]/route.ts`
- `apps/web/src/server/routers/cli.ts`

### 2.6 JSON Envelope Contract
All command-mode responses use a standardized envelope:
```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "requestId": "uuid",
    "sessionId": "sess_x",
    "capabilitiesVersion": 12,
    "cursor": null
  }
}
```
Error responses set `ok: false`, `data: null`, and `error` to a human-readable message.

Reference points:
- `packages/cli/src/lib/envelope.ts`

### 2.7 Exit Code Contract
| Code | Meaning | When |
|------|---------|------|
| 0 | Success | Command completed |
| 2 | Validation | Bad arguments, invalid JSON (HTTP 400/422) |
| 3 | Policy denied | Forbidden by policy (HTTP 403) |
| 4 | Approval required | Action pending approval (HTTP 202) |
| 5 | Retryable | Transient failure, safe to retry (HTTP 429/5xx) |
| 6 | Terminal | Fatal failure, do not retry (HTTP 401 after refresh, 404) |

Interactive mode preserves OpenCode child process exit code propagation.

Reference points:
- `packages/cli/src/lib/exit-codes.ts`

### 2.8 Auth Refresh (Sandbox Mode)
- CLI reads `PROLIFERATE_SESSION_TOKEN` from env at each request (not cached at module load).
- On 401, re-reads the token from env and retries once.
- If the retry also returns 401, exits with code 6 (`auth_expired`).
- CLI never persists long-lived auth on disk in sandbox mode.
- Daemon-mediated IPC refresh is deferred to Phase B (PR 24).

Reference points:
- `packages/cli/src/lib/gateway-client.ts`

---

## 3. File Tree

```
packages/cli/src/
  index.ts                    # Entrypoint: command routing + interactive fallback
  main.ts                     # Interactive flow: auth → config → session → sync → OpenCode
  commands/
    session.ts                # session info|status|capabilities
    manager.ts                # manager child spawn|list|inspect|message|cancel
    source.ts                 # source list-bindings|query|get
    action.ts                 # action invoke|status
    baseline.ts               # baseline info|targets
  lib/
    constants.ts              # CLI_VERSION, GATEWAY_URL
    device.ts                 # Device ID generation and persistence
    env.ts                    # CLI env adapter (apiUrl, gatewayUrl)
    envelope.ts               # JSON envelope types and helpers
    exit-codes.ts             # Exit code constants and HTTP status mapper
    gateway-client.ts         # Authenticated gateway HTTP client with 401 retry
    opencode.ts               # OpenCode binary resolution + launch
    ssh.ts                    # SSH key generation, fingerprinting, path hashing
    sync.ts                   # rsync-based file sync to sandbox
  lib/__tests__/
    envelope.test.ts          # Golden contract: envelope shape
    exit-codes.test.ts        # Golden contract: exit code mapping
    gateway-client.test.ts    # Golden contract: auth refresh behavior
  state/
    auth.ts                   # Auth persistence + device flow
    config.ts                 # Config persistence
```

---

## 5. Conventions & Patterns

### Do
- Keep the runtime path linear and explicit in `main.ts`.
- Use gateway clients for session creation, health checks, and OpenCode URL derivation.
- Use `hashPrebuildPath()` for CLI workspace identity.
- Preserve local file permission constraints (`0o700` dir, `0o600` state files).
- Treat gateway as source of truth for session creation semantics.
- Use the JSON envelope for all command-mode output.
- Map HTTP errors to differentiated exit codes.
- Read session token at request time (not module load) to support future daemon refresh.

### Don't
- Don't introduce alternate orchestration paths in CLI command handling.
- Don't route real-time/session streaming behavior through web API wrappers.
- Don't assume `/api/cli/*` compatibility without verifying deployed routing.
- Don't silently change session typing/origin semantics without updating gateway + services together.
- Don't duplicate OpenCode binary resolution logic in new locations (single source: `lib/opencode.ts`).
- Don't use human-readable output (chalk, spinners) in command mode.
- Don't cache env-var tokens at module load time.

### Error Semantics
- Session creation errors are fatal and terminate the CLI process.
- Sync errors are warnings and do not block OpenCode launch.
- Token invalidation triggers state clear + re-auth path (interactive) or exit code 6 (command mode).
- Duplicate SSH key registration is treated as a safe, non-fatal condition in CLI auth flow.
- Unknown commands in namespace routing produce exit code 2 (validation).

### Reliability Semantics
- Device polling tolerates transient network failures and continues until timeout.
- Interactive mode: CLI process exit code mirrors OpenCode child process exit.
- Command mode: CLI exit code maps from HTTP response status.
- Missing SSH connectivity metadata (`sshHost`, `sshPort`) is treated as fatal for sync-enabled startup.

---

## 6. Subsystem Deep Dives (Invariants)

### 6.1 CLI Runtime Invariants
- CLI has two modes: interactive (default) and command (namespace routing).
- Namespace commands: `session`, `manager`, `source`, `action`, `baseline`.
- Unsupported platforms fail fast before any stateful operation.
- Unknown top-level commands fall through to interactive mode.
- Main flow ordering is fixed by dependency gates: auth must resolve before session creation.
- Command mode requires `PROLIFERATE_SESSION_TOKEN`, `PROLIFERATE_GATEWAY_URL`, and `PROLIFERATE_SESSION_ID` env vars.

Evidence:
- `packages/cli/src/index.ts`
- `packages/cli/src/main.ts`

### 6.2 Auth & Token Invariants
- Interactive: Auth cache is optimistic but must pass gateway health check on each invocation.
- Interactive: Device auth completion must return token + user + org before local auth state is written.
- Interactive: Polling cadence is server-driven (`interval`) with hard attempt bounds in CLI.
- Command mode: Token is read from `PROLIFERATE_SESSION_TOKEN` env var at each request.
- Command mode: On 401, token is re-read from env and request is retried once.
- Command mode: Double 401 produces `CliError` with exit code 6 and code `auth_expired`.

Evidence:
- `packages/cli/src/state/auth.ts`
- `packages/cli/src/lib/gateway-client.ts`
- `packages/cli/src/lib/__tests__/gateway-client.test.ts`

### 6.3 Configuration & Identity Invariants
- Local config read must be side-effect free except for ensuring state directory existence.
- `apiUrl` resolution is deterministic and currently file-first over env/default.
- Device identity is lazily created once and reused.
- Workspace hash identity for CLI must remain device-scoped.

Evidence:
- `packages/cli/src/state/config.ts`
- `packages/cli/src/lib/device.ts`
- `packages/cli/src/lib/ssh.ts`

### 6.4 Session Creation Invariants
- Gateway session creation requires exactly one configuration source (`configurationId`, `managedConfiguration`, or `cliConfiguration`).
- SSH-enabled session requests are effectively immediate even if caller asks for deferred.
- Billing gate assertion runs before configuration resolution and session creation in gateway.
- CLI runtime session creation must include `cliConfiguration.localPathHash` and SSH public key.
- Gateway response is authoritative for whether sandbox connectivity is ready at return time.

Evidence:
- `packages/cli/src/main.ts`
- `apps/gateway/src/api/proliferate/http/sessions.ts`
- `apps/gateway/src/lib/configuration-resolver.ts`
- `apps/gateway/src/lib/session-creator.ts`

### 6.5 Sync Invariants
- File transfer direction is local-to-sandbox only.
- Missing local paths are filtered out rather than treated as hard errors.
- Remote writes occur as `root` over SSH, followed by ownership normalization to `user:user`.
- `.gitignore` filtering is conditional on `.gitignore` presence in each source directory.
- Sync job failure does not invalidate an already-created session.

Evidence:
- `packages/cli/src/lib/sync.ts`
- `packages/cli/src/main.ts`

### 6.6 OpenCode Handoff Invariants
- Attach URL is generated through gateway proxy semantics and includes encoded bearer token.
- Binary resolution is consolidated in `lib/opencode.ts` (single source of truth).
- Binary resolution searches development path, installed path, and same-dir path before failing.
- OpenCode child process inherits terminal stdio and process environment.
- Parent CLI exits with the child process exit code.

Evidence:
- `packages/gateway-clients/src/clients/external/opencode.ts`
- `packages/cli/src/lib/opencode.ts`
- `packages/cli/src/main.ts`

### 6.7 Envelope & Exit Code Invariants
- All command-mode output is JSON envelope to stdout.
- Envelope always has: `ok` (boolean), `data` (payload or null), `error` (string or null), `meta` (object).
- `meta` always has: `requestId` (UUID), `sessionId`, `capabilitiesVersion`, `cursor` (all nullable).
- Each request generates a unique `requestId`.
- Exit codes never use 1 (reserved for general/unhandled errors).
- HTTP 202 maps to exit code 4 (approval required) with a success envelope.

Evidence:
- `packages/cli/src/lib/envelope.ts`
- `packages/cli/src/lib/exit-codes.ts`
- `packages/cli/src/lib/__tests__/envelope.test.ts`
- `packages/cli/src/lib/__tests__/exit-codes.test.ts`

### 6.8 Web/Service CLI Surface Invariants
- Business logic for CLI metadata and auth state transitions lives in `packages/services/src/cli`.
- Web app CLI router exposes oRPC procedures under `/api/rpc`, not standalone REST handlers for every CLI domain.
- `/api/cli/sessions`, `/api/cli/auth/device`, `/api/cli/auth/device/poll`, and `/api/cli/ssh-keys` are standalone compatibility routes over service/oRPC logic.
- CLI GitHub selection is short-lived and consumed-on-success to avoid stale polling state.

Evidence:
- `apps/web/src/server/routers/cli.ts`
- `apps/web/src/app/api/rpc/[[...rest]]/route.ts`
- `apps/web/src/app/api/cli/sessions/route.ts`
- `packages/services/src/cli/service.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | CLI/Web -> Gateway | `createSyncClient`, `createOpenCodeClient`, `/proliferate/sessions` | Canonical session creation/attach contract |
| `sandbox-providers.md` | Gateway -> Provider | `create`, `snapshot`, `terminate` | SSH/immediate behavior is provider-backed |
| `auth-orgs.md` | CLI router -> Auth | `auth.api.createApiKey` | Poll completion mints API key |
| `billing-metering.md` | Gateway -> Billing | `assertBillingGateForOrg` | Enforced before session creation |
| `integrations.md` | CLI router/services -> Integrations/Nango | status/select/connect flows | GitHub connection check and selection handoff |
| `repos-prebuilds.md` | Gateway resolver -> Config/Repo linkage | CLI config+repo linking | Device-scoped workspace to configuration mapping |
| `actions.md` | CLI -> Gateway | `/proliferate/:sessionId/actions/invoke` | Action invocation in command mode |

### Security
- Device code TTL and one-time completion behavior reduce replay window.
- API keys produced by device flow are currently non-expiring.
- SSH private key material remains local; only public key is uploaded.
- Local auth/config/device identity files are permissioned for single-user access.
- Command-mode tokens are read from env vars, never persisted to disk.
- Gateway client sends Authorization header; token is never logged.

### Observability
- Gateway and web CLI paths emit structured logs with CLI-specific context.
- CLI process logging is user-facing (chalk/spinner UX) in interactive mode, not centralized structured telemetry.
- Command-mode output is machine-parseable JSON envelope.

---

## 8. Acceptance Gates

- [x] `docs/specs/cli.md` reflects current runtime contracts and drift points.
- [x] Section 6 remains invariant-based (no imperative runbook steps).
- [x] Mental model + agent-error guidance is updated from source behavior.
- [ ] Manual sanity checks pass for: auth flow, session creation, sync warning path, OpenCode handoff.
- [x] JSON envelope and exit codes match spec contract.
- [x] Auth/token lifecycle works with env-var auth (daemon-mediated refresh deferred to Phase B).
- [x] Golden contract tests pass (50 tests across envelope, exit codes, auth refresh).
- [ ] Manager child orchestration commands work end-to-end (requires live gateway).
- [ ] Source read commands work through gateway mediation (requires source endpoints from PR 19).
- [ ] Action invocation returns correct exit codes for approval/denial/failure (requires live gateway).

---

## 9. Known Limitations & Tech Debt

- [x] **CLI auth endpoint compatibility surface**: compatibility handlers exist for `/api/cli/auth/*` and `/api/cli/ssh-keys` alongside `/api/cli/sessions`, reducing `/api/rpc` vs `/api/cli/*` contract drift.
- [ ] **Legacy session query filters**: CLI service list/resume queries still filter `session_type = "terminal"` while gateway CLI session creation uses `sessionType: "cli"`. Impact: stale CLI session views/resume logic risk.
- [x] **~~`lib/api.ts` is stale and inconsistent~~**: Deleted. Was dead code referencing removed endpoints.
- [x] **~~Duplicate OpenCode binary path logic~~**: Consolidated into `packages/cli/src/lib/opencode.ts`. `agents/opencode.ts` deleted.
- [ ] **Long-lived API keys**: device-flow API keys are created without expiration. Impact: credential lifetime risk.
- [ ] **Empty config sync defaults**: `CONFIG_SYNC_JOBS` is currently empty. Impact: user environment parity in sandbox relies mostly on repo contents and manual setup.
- [ ] **Daemon-mediated IPC refresh (C2b)**: Deferred to Phase B (PR 24). Currently, 401 retry re-reads the same env var. When the daemon exists, it will update the env var before the retry reads it.
- [ ] **Source/baseline gateway endpoints**: CLI commands for source reads and baseline info call gateway endpoints that may not exist yet (depend on PR 19 and future work). Commands are structurally correct and will work when endpoints are available.
