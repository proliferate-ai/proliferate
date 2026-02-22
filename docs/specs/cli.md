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

### Out of Scope
- Gateway runtime internals after session creation (`sessions-gateway.md`)
- Sandbox provider boot internals (`sandbox-providers.md`)
- Global auth internals and key revocation UX (`auth-orgs.md`)
- Billing policy design (`billing-metering.md`)
- Nango/provider lifecycle outside CLI-specific handoff (`integrations.md`)

### Mental Models
- The CLI is an orchestrator, not a platform. It coordinates existing systems and exits.
- The authoritative runtime path is gateway-native for session creation and attach (`@proliferate/gateway-clients`).
- Device auth is a two-phase handshake: browser authorization marks state; poll completion mints the API key.
- `localPathHash` is device-scoped identity for a workspace, not a global repo identity.
- Sync is intentionally one-way (local -> sandbox) and best-effort relative to session startup.
- CLI UX is deterministic and linear: auth gate, config gate, session gate, sync, handoff to OpenCode.

### Things Agents Get Wrong
- Assuming API routes are in the streaming path. They are not; real-time flows are gateway-based.
- Assuming `/api/cli/*` routes are fully absent. This repo now provides compatibility handlers for `/api/cli/sessions`, `/api/cli/auth/device`, `/api/cli/auth/device/poll`, and `/api/cli/ssh-keys`, while broader CLI logic still lives under oRPC.
- Assuming device authorization itself creates the token. Token creation happens in poll completion (`pollDevice`).
- Assuming `hashLocalPath()` is the correct identifier for CLI sessions. Runtime uses `hashPrebuildPath()` (device-scoped).
- Assuming config precedence is env-over-file. `getConfig()` currently resolves `apiUrl` as file override first, then env/default.
- Assuming CLI session listings reflect gateway-created CLI sessions without drift. Legacy query filters still expect `session_type = "terminal"`.
- Assuming sync failure is fatal. Current runtime warns and continues.
- Assuming the CLI supports Windows. It exits early with a WSL2 recommendation.

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

---

## 5. Conventions & Patterns

### Do
- Keep the runtime path linear and explicit in `main.ts`.
- Use gateway clients for session creation, health checks, and OpenCode URL derivation.
- Use `hashPrebuildPath()` for CLI workspace identity.
- Preserve local file permission constraints (`0o700` dir, `0o600` state files).
- Treat gateway as source of truth for session creation semantics.

### Don’t
- Don’t introduce alternate orchestration paths in CLI command handling.
- Don’t route real-time/session streaming behavior through web API wrappers.
- Don’t assume `/api/cli/*` compatibility without verifying deployed routing.
- Don’t silently change session typing/origin semantics without updating gateway + services together.
- Don’t duplicate OpenCode binary resolution logic in new locations.

### Error Semantics
- Session creation errors are fatal and terminate the CLI process.
- Sync errors are warnings and do not block OpenCode launch.
- Token invalidation triggers state clear + re-auth path.
- Duplicate SSH key registration is treated as a safe, non-fatal condition in CLI auth flow.

### Reliability Semantics
- Device polling tolerates transient network failures and continues until timeout.
- CLI process exit code mirrors OpenCode child process exit.
- Missing SSH connectivity metadata (`sshHost`, `sshPort`) is treated as fatal for sync-enabled startup.

---

## 6. Subsystem Deep Dives (Invariants)

### 6.1 CLI Runtime Invariants
- CLI command surface is intentionally minimal: main flow plus reset.
- Unsupported platforms fail fast before any stateful operation.
- Unknown positional arguments do not create alternate commands; they fall through to main flow.
- Main flow ordering is fixed by dependency gates: auth must resolve before session creation.

Evidence:
- `packages/cli/src/index.ts`
- `packages/cli/src/main.ts`

### 6.2 Auth & Token Invariants
- Auth cache is optimistic but must pass gateway health check on each invocation.
- Device auth completion must return token + user + org before local auth state is written.
- Polling cadence is server-driven (`interval`) with hard attempt bounds in CLI.
- Device codes are single-use from a practical perspective: completion deletes the code record.
- SSH key bootstrap is part of post-auth readiness, but failure to register existing duplicates is non-fatal.

Evidence:
- `packages/cli/src/state/auth.ts`
- `apps/web/src/server/routers/cli.ts` (`createDeviceCode`, `authorizeDevice`, `pollDevice`)
- `packages/services/src/cli/service.ts`

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
- Binary resolution must search development and installed layouts before failing.
- OpenCode child process inherits terminal stdio and runtime-filtered environment.
- Parent CLI exits with the child process exit code.

Evidence:
- `packages/gateway-clients/src/clients/external/opencode.ts`
- `packages/cli/src/agents/opencode.ts`
- `packages/cli/src/main.ts`

### 6.7 Web/Service CLI Surface Invariants
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

### Security
- Device code TTL and one-time completion behavior reduce replay window.
- API keys produced by device flow are currently non-expiring.
- SSH private key material remains local; only public key is uploaded.
- Local auth/config/device identity files are permissioned for single-user access.

### Observability
- Gateway and web CLI paths emit structured logs with CLI-specific context.
- CLI process logging is user-facing (chalk/spinner UX), not centralized structured telemetry.

---

## 8. Acceptance Gates

- [ ] `docs/specs/cli.md` reflects current runtime contracts and drift points.
- [ ] Section 6 remains invariant-based (no imperative runbook steps).
- [ ] Mental model + agent-error guidance is updated from source behavior.
- [ ] Manual sanity checks pass for: auth flow, session creation, sync warning path, OpenCode handoff.
- [ ] Any behavior change introduced alongside this spec update is reflected in code and referenced specs.

---

## 9. Known Limitations & Tech Debt

- [x] **CLI auth endpoint compatibility surface**: compatibility handlers exist for `/api/cli/auth/*` and `/api/cli/ssh-keys` alongside `/api/cli/sessions`, reducing `/api/rpc` vs `/api/cli/*` contract drift (`apps/web/src/app/api/cli/auth/device/route.ts`, `apps/web/src/app/api/cli/auth/device/poll/route.ts`, `apps/web/src/app/api/cli/ssh-keys/route.ts`, `apps/web/src/app/api/cli/sessions/route.ts`).
- [ ] **Legacy session query filters**: CLI service list/resume queries still filter `session_type = "terminal"` while gateway CLI session creation uses `sessionType: "cli"`. Impact: stale CLI session views/resume logic risk.
- [ ] **`lib/api.ts` is stale and inconsistent**: it references endpoints and imports (`getAuth` from config module) that do not match current runtime path. Impact: dead-code traps and incorrect agent edits.
- [ ] **Duplicate OpenCode binary path logic**: both `packages/cli/src/lib/opencode.ts` and `packages/cli/src/agents/opencode.ts` implement similar resolution logic. Impact: drift risk and duplicated fixes.
- [ ] **Long-lived API keys**: device-flow API keys are created without expiration. Impact: credential lifetime risk.
- [ ] **Empty config sync defaults**: `CONFIG_SYNC_JOBS` is currently empty. Impact: user environment parity in sandbox relies mostly on repo contents and manual setup.
