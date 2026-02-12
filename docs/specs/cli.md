# CLI — System Spec

## 1. Scope & Purpose

### In Scope
- CLI entry point, command parsing, and main flow orchestration
- Device auth flow (OAuth device code → API key → token persistence)
- Local config and state management (`~/.proliferate/` directory)
- SSH key generation, storage, and upload
- File sync (unidirectional local → sandbox via rsync over SSH)
- OpenCode binary discovery and launch
- CLI-specific API routes (auth, repos, sessions, SSH keys, GitHub, prebuilds)
- CLI-specific database tables (device codes, SSH keys, GitHub selections)
- Device ID generation and prebuild path hashing
- CLI package structure and Deno-based build

### Out of Scope
- Session lifecycle after creation (pause/resume/snapshot/delete) — see `sessions-gateway.md` §6
- Sandbox boot mechanics and provider interface — see `sandbox-providers.md` §6
- Repo/prebuild management beyond CLI-specific routes — see `repos-prebuilds.md`
- Auth system internals / better-auth — see `auth-orgs.md`
- Billing credit checks (called but not owned) — see `billing-metering.md`
- GitHub OAuth connection lifecycle via Nango — see `integrations.md`

### Mental Model

The CLI is the local entry point for developers who want to connect their local workspace to a Proliferate sandbox. It runs a single linear flow: **authenticate → configure → create session → sync files → launch OpenCode**. The entire flow completes in seconds and results in an interactive coding agent attached to a remote sandbox that mirrors the user's local directory.

The CLI is a compiled Deno binary that bundles an OpenCode binary for the current platform. It communicates with two backends: the **web API** (for device auth, SSH keys, repos) and the **gateway** (for session creation and OpenCode attachment). Authentication is token-based — the device flow produces a better-auth API key that is stored locally and reused across sessions.

**Core entities:**
- **Device code** — a short-lived code pair (user code + device code) used in the OAuth device authorization flow. The user code is human-readable (e.g., `ABCD-1234`); the device code is a 32-byte hex secret for polling.
- **SSH key** — an ed25519 key pair generated per machine, stored in `~/.proliferate/`. The public key is uploaded to the server and injected into sandboxes for rsync access.
- **Device ID** — a per-machine random identifier stored in `~/.proliferate/device-id`. Used to scope prebuild hashes so the same local path on different machines maps to different prebuilds.
- **Local path hash** — a 16-char hex SHA-256 of `{deviceId}::{absolutePath}`. Uniquely identifies a local project directory per device for session/repo/prebuild matching.

**Key invariants:**
- The CLI is unidirectional: files flow from local → sandbox only, never sandbox → local.
- One SSH key pair per machine. Re-running the CLI reuses the existing key.
- Token persistence uses file permissions (`0o600`) for security. The `~/.proliferate/` directory uses `0o700`.
- The CLI exits with the same exit code as the OpenCode process.

---

## 2. Core Concepts

### OAuth Device Code Flow
The CLI uses RFC 8628 device authorization. The CLI requests a device code from the API, displays a user code, opens a browser to the verification URL, and polls until the user authorizes. On success, the API creates a better-auth API key (non-expiring) and returns it.
- Key detail agents get wrong: the poll endpoint creates the API key, not the authorize endpoint. Authorization and key creation are separate steps — the `/device` page calls `authorizeDevice`, then the CLI's next poll call triggers `pollDevice` which creates the API key.
- Reference: `packages/cli/src/state/auth.ts:deviceFlow`, `apps/web/src/server/routers/cli.ts:cliAuthRouter`

### Gateway Client SDK
The CLI uses `@proliferate/gateway-clients` to communicate with the gateway for session creation and OpenCode attachment. Two client types: `createSyncClient` for session management and `createOpenCodeClient` for getting the OpenCode attach URL.
- Key detail agents get wrong: the main flow in `main.ts` uses the gateway SDK directly, not the web API routes. The `ApiClient` in `packages/cli/src/lib/api.ts` is an older HTTP client that talks to web API routes — both exist in the codebase.
- Reference: `packages/cli/src/main.ts`, `packages/gateway-clients/`

### Deno Compilation
The CLI is written in TypeScript with `.ts` extensions in imports and compiled to standalone binaries using `deno compile`. It does not use `tsc` for emit — `noEmit: true` is set. Cross-compilation targets four platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`.
- Key detail agents get wrong: the `package.json` version is embedded in the binary via `--include=package.json`. Version reading uses `import.meta.dirname` which works in both dev (Deno) and compiled binary contexts.
- Reference: `packages/cli/package.json`, `packages/cli/src/lib/constants.ts`

---

## 3. File Tree

```
packages/cli/
├── package.json                         # v0.3.9, bin: proliferate, Deno compile scripts
├── tsconfig.json                        # ES2022, noEmit, bundler resolution
├── bin/                                 # Platform-specific OpenCode binaries (not in git)
│   ├── opencode-darwin-arm64
│   ├── opencode-darwin-x64
│   ├── opencode-linux-arm64
│   └── opencode-linux-x64
└── src/
    ├── index.ts                         # Entry point: --version, --help, reset, main()
    ├── main.ts                          # Main flow: auth → config → session → sync → opencode
    ├── state/
    │   ├── auth.ts                      # Device flow, token persistence, health check
    │   └── config.ts                    # ~/.proliferate/config.json management
    ├── lib/
    │   ├── constants.ts                 # CLI_VERSION, GATEWAY_URL, GITHUB_REPO
    │   ├── ssh.ts                       # SSH key generation, fingerprinting, path hashing
    │   ├── device.ts                    # Device ID generation and persistence
    │   ├── sync.ts                      # FileSyncer class (rsync-based)
    │   ├── api.ts                       # ApiClient (HTTP client for web API routes)
    │   └── opencode.ts                  # OpenCode binary path resolution (lib variant)
    └── agents/
        └── opencode.ts                  # OpenCode launch (spawn with attach URL)

packages/services/src/cli/
├── index.ts                             # Re-exports from service.ts
├── service.ts                           # Business logic (device codes, SSH, repos, sessions)
└── db.ts                                # Drizzle queries (50+ functions)

packages/shared/src/contracts/
└── cli.ts                               # Zod schemas + ts-rest contract

packages/db/src/schema/
└── cli.ts                               # Tables: userSshKeys, cliDeviceCodes, cliGithubSelections

apps/web/src/server/routers/
└── cli.ts                               # oRPC router (6 sub-routers)

apps/web/src/app/
├── api/cli/sessions/route.ts            # Standalone POST route (gateway SDK session creation)
└── device/page.tsx                      # Device code authorization page
```

---

## 4. Data Models & Schemas

### Database Tables

```
cli_device_codes
├── id              UUID PRIMARY KEY
├── user_code       TEXT NOT NULL UNIQUE    -- human-readable (ABCD-1234)
├── device_code     TEXT NOT NULL UNIQUE    -- 32-byte hex secret
├── user_id         TEXT FK → user(id)     -- set on authorization
├── org_id          TEXT FK → organization(id)  -- set on authorization
├── status          TEXT NOT NULL DEFAULT 'pending'  -- pending|authorized|expired
├── expires_at      TIMESTAMPTZ NOT NULL   -- 15 minutes from creation
├── created_at      TIMESTAMPTZ
└── authorized_at   TIMESTAMPTZ            -- set when user approves

Indexes: user_code, device_code, expires_at
```

```
user_ssh_keys
├── id              UUID PRIMARY KEY
├── user_id         TEXT NOT NULL FK → user(id) CASCADE
├── public_key      TEXT NOT NULL
├── fingerprint     TEXT NOT NULL UNIQUE    -- SHA256 base64 format
├── name            TEXT                    -- e.g., "hostname-cli"
└── created_at      TIMESTAMPTZ

Index: user_id
```

```
cli_github_selections
├── user_id         TEXT NOT NULL FK → user(id) CASCADE  ┐
├── organization_id TEXT NOT NULL FK → organization(id)  ┘ COMPOSITE PK
├── connection_id   TEXT NOT NULL
├── expires_at      TIMESTAMPTZ NOT NULL   -- 5 minutes from creation
└── created_at      TIMESTAMPTZ

Index: expires_at
```

Source: `packages/db/src/schema/cli.ts`

### Core TypeScript Types

```typescript
// packages/cli/src/state/auth.ts
interface StoredAuth {
  token: string;
  user: { id: string; email: string; name?: string };
  org: { id: string; name: string };
}

// packages/cli/src/state/config.ts
interface Config {
  apiUrl?: string;       // Override for NEXT_PUBLIC_API_URL
  syncMode?: "gitignore" | "all";
  modelId?: string;      // Agent model override
}

// packages/cli/src/lib/ssh.ts
interface SSHKeyInfo {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  fingerprint: string;   // SHA256:xxx format from ssh-keygen
}

// packages/cli/src/lib/sync.ts
interface SyncJob {
  local: string;         // Local path (supports ~)
  remote: string;        // Remote path on sandbox
  delete?: boolean;      // Remove files not in source
  excludes?: string[];
  respectGitignore?: boolean;
}
```

### Local Filesystem Layout

```
~/.proliferate/
├── token              # StoredAuth JSON (0o600)
├── config.json        # Config JSON (0o600)
├── device-id          # 8-char UUID prefix (0o600)
├── id_ed25519         # SSH private key
└── id_ed25519.pub     # SSH public key
```

---

## 5. Conventions & Patterns

### Do
- Use `@proliferate/gateway-clients` for gateway communication — it handles auth headers and connection management.
- Hash local paths with `hashPrebuildPath()` (device-scoped) for prebuild matching, not `hashLocalPath()` (device-agnostic).
- Return structured errors via `ORPCError` in API routes — the CLI checks `response.ok` and parses error messages.
- Use `ora` spinners for all long-running CLI operations — keeps UX consistent.

### Don't
- Add Windows support — the CLI exits immediately on `win32` with a WSL2 recommendation (`packages/cli/src/index.ts:12-17`).
- Use `console.log` for structured output — the CLI uses `chalk` for colored terminal output and `ora` for spinners.
- Add new CLI commands without updating the help text in `packages/cli/src/index.ts`.
- Import `@proliferate/db` directly in CLI service code — use `@proliferate/services/db/client` per project conventions.

### Error Handling

```typescript
// CLI-side pattern: spinners with fail/succeed
const spinner = ora("Creating session...").start();
try {
  const result = await client.createSession({ ... });
  spinner.succeed("Session ready");
} catch (err) {
  spinner.fail("Failed to create session");
  console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
  process.exit(1);
}
```

Source: `packages/cli/src/main.ts:38-68`

### Reliability
- **Auth token validation**: Token is verified via gateway health check on every CLI invocation. Expired tokens trigger automatic re-auth via device flow. Source: `packages/cli/src/state/auth.ts:ensureAuth`
- **Device flow polling**: 5-second intervals, 180 attempts (15-minute timeout). Network errors during polling are silently retried. Source: `packages/cli/src/state/auth.ts:151-205`
- **Sync failures**: Non-fatal. The CLI warns but continues to OpenCode launch. Source: `packages/cli/src/main.ts:103-106`
- **Device code expiry**: 900 seconds (15 minutes). Codes in `pending` status past `expires_at` are treated as `expired` on next poll. Source: `packages/services/src/cli/service.ts:createDeviceCode`

---

## 6. Subsystem Deep Dives

### 6.1 CLI Entry Point and Main Flow

**What it does:** Parses arguments, gates Windows, and orchestrates the auth → config → session → sync → opencode pipeline. **Status: Implemented**

**Happy path:**
1. `packages/cli/src/index.ts` checks for `--version`, `--help`, `reset` commands
2. Default path calls `main()` from `packages/cli/src/main.ts`
3. `ensureAuth()` — returns cached token or runs device flow
4. `ensureConfig()` — reads `~/.proliferate/config.json` with env fallbacks
5. `createSyncClient()` — creates gateway client with CLI token
6. `client.createSession()` — creates session with `sandboxMode: "immediate"` (sandbox ready in response)
7. `FileSyncer.sync()` — rsync workspace + config to sandbox via SSH
8. `createOpenCodeClient().getUrl()` — gets OpenCode attach URL from gateway
9. `launchOpenCode(attachUrl)` — spawns OpenCode binary in attach mode
10. Process exits with OpenCode's exit code

**Edge cases:**
- Windows → immediate exit with WSL2 recommendation
- `proliferate reset` → deletes `~/.proliferate/` entirely and exits
- Sync failure → warns but continues (sandbox may still work without local files)
- Missing SSH host/port from session response → exits with error

**Files touched:** `packages/cli/src/index.ts`, `packages/cli/src/main.ts`

### 6.2 Device Auth Flow

**What it does:** Authenticates the CLI user via OAuth device code flow, producing a persistent API key. **Status: Implemented**

**Happy path:**
1. CLI POSTs to `{apiUrl}/api/cli/auth/device` (no auth required)
2. Server generates user code (4 alpha + 4 digits, e.g., `ABCD-1234`) and device code (32-byte hex) via `cli.createDeviceCode()` (`packages/services/src/cli/service.ts`)
3. Server stores code pair in `cli_device_codes` with 15-minute expiry, status `pending`
4. CLI displays user code, opens browser to `{baseUrl}/device?code={userCode}`
5. User visits `/device` page (`apps/web/src/app/device/page.tsx`), enters or auto-submits code
6. Page calls `cliAuthRouter.authorizeDevice` — sets `user_id`, `org_id`, `status=authorized` on the device code row
7. CLI polls `{apiUrl}/api/cli/auth/device/poll` with device code every 5 seconds
8. On `status=authorized`: `cliAuthRouter.pollDevice` creates a better-auth API key via `auth.api.createApiKey()`, checks GitHub connection status, deletes the device code row
9. CLI saves `{ token, user, org }` to `~/.proliferate/token` (mode `0o600`)
10. CLI generates SSH key pair if needed and uploads public key to `/api/cli/ssh-keys`

**Edge cases:**
- `DEV_USER_ID` env var set → device code is auto-approved on creation (dev shortcut). Source: `apps/web/src/server/routers/cli.ts:142-147`
- SSH key already registered → `409 CONFLICT` is caught and treated as success. Source: `packages/cli/src/state/auth.ts:240-256`
- Token health check fails on subsequent runs → clears token, re-runs device flow. Source: `packages/cli/src/state/auth.ts:82-88`

**Files touched:** `packages/cli/src/state/auth.ts`, `apps/web/src/server/routers/cli.ts:cliAuthRouter`, `packages/services/src/cli/service.ts`, `apps/web/src/app/device/page.tsx`

### 6.3 Local Config Management

**What it does:** Manages CLI configuration in `~/.proliferate/config.json` with environment variable fallbacks. **Status: Implemented**

**Config resolution (priority order):**
1. `config.json` values (user-set overrides)
2. Environment variables (e.g., `NEXT_PUBLIC_API_URL` for `apiUrl`)

**Files in `~/.proliferate/`:**

| File | Content | Created by |
|------|---------|-----------|
| `token` | `StoredAuth` JSON | Device flow |
| `config.json` | `Config` JSON | `saveConfig()` |
| `device-id` | 8-char UUID prefix | `getDeviceId()` |
| `id_ed25519` | SSH private key | `generateSSHKey()` |
| `id_ed25519.pub` | SSH public key | `generateSSHKey()` |

All files use `0o600` permissions. Directory uses `0o700`.

**Files touched:** `packages/cli/src/state/config.ts`, `packages/cli/src/lib/device.ts`

### 6.4 File Sync

**What it does:** Pushes local workspace files to the sandbox via rsync over SSH. **Status: Implemented**

**Happy path:**
1. `FileSyncer` initialized with sandbox SSH host and port
2. Main workspace synced from `cwd` to `/home/user/workspace` with `--delete` and `.gitignore` filtering
3. Additional config sync jobs from `CONFIG_SYNC_JOBS` (currently empty array)
4. Rsync uses `--info=progress2` for percentage-based progress reporting
5. After all jobs complete, `chown -R user:user /home/user` fixes ownership (rsync runs as root)

**Rsync flags:** `-az` (archive + compress), `--no-inc-recursive` (full file list for accurate progress), `-e ssh` with `StrictHostKeyChecking=no`, `IdentitiesOnly=yes`, `ConnectTimeout=10`.

**Edge cases:**
- Non-existent local paths are silently skipped (filtered before sync)
- Non-directory files get `mkdir -p` for parent directory on remote before transfer
- `.gitignore` filtering only applies if `.gitignore` exists in the source directory
- Sync errors are non-fatal — CLI warns and continues

**Files touched:** `packages/cli/src/lib/sync.ts`, `packages/cli/src/main.ts:79-106`

### 6.5 OpenCode Launch

**What it does:** Locates the bundled OpenCode binary and spawns it in attach mode. **Status: Implemented**

**Binary resolution order:**
1. `{__dirname}/../../bin/opencode-{platform}-{arch}` — development path
2. `{execPath}/../bin/opencode-{platform}-{arch}` — installed via npm/curl
3. `{execPath}/../opencode-{platform}-{arch}` — same directory as CLI binary

Platform: `darwin` or `linux`. Arch: `arm64` or `x64`.

The binary is spawned with `stdio: "inherit"` (shares terminal) and `env: runtimeEnv` (filtered environment). The CLI exits with OpenCode's exit code.

**Files touched:** `packages/cli/src/agents/opencode.ts`, `packages/cli/src/lib/opencode.ts`

### 6.6 CLI API Routes

**What it does:** Six oRPC sub-routers serve CLI-specific endpoints via `/api/rpc`. **Status: Implemented**

**Route summary (23 procedures across 6 sub-routers):**

| Sub-router | Procedure | Auth | Purpose |
|-----------|-----------|------|---------|
| `cliAuthRouter` | `createDeviceCode` | Public | Start device flow |
| | `authorizeDevice` | Protected | User approves device code |
| | `pollDevice` | Public | CLI polls for authorization |
| `cliSshKeysRouter` | `list` | Protected | List user's SSH keys |
| | `create` | Protected | Upload public key |
| | `delete` | Protected | Delete specific key |
| | `deleteAll` | Protected | Delete all user keys |
| `cliReposRouter` | `get` | Org | Get repo by path hash |
| | `create` | Org | Create/link local repo |
| | `deleteAll` | Org | Delete all local repos |
| `cliSessionsRouter` | `list` | Org | List CLI sessions |
| | `create` | Org | Create/resume terminal session |
| | `get` | Org | Get session details |
| | `delete` | Org | Terminate session |
| | `deleteAll` | Org | Terminate all sessions |
| | `checkSandboxes` | Protected | Check sandbox liveness |
| `cliGitHubRouter` | `status` | Org | Check GitHub connection |
| | `connect` | Org | Start Nango OAuth flow |
| | `connectStatus` | Org | Poll OAuth completion |
| | `select` | Org | Store connection selection |
| `cliPrebuildsRouter` | `get` | Protected | Lookup prebuild by path hash |
| | `create` | Protected | Snapshot + upsert prebuild |
| | `delete` | Protected | Delete prebuild |

**Session creation flow (`cliSessionsRouter.create`):**
1. Billing gate check (resume vs new session). See `billing-metering.md`.
2. If `resume=true`, look for running session with matching `localPathHash`
3. Fetch user's SSH public keys (required — error if none)
4. Optionally fetch GitHub token via integration connection
5. Create session in DB with `origin: "cli"`, `session_type: "terminal"`
6. Call `provider.createTerminalSandbox()` with SSH keys, env vars, clone instructions
7. Update session with sandbox ID and status `running`

**Standalone route (`POST /api/cli/sessions`):**
A separate Next.js route (`apps/web/src/app/api/cli/sessions/route.ts`) creates CLI sessions via the gateway SDK with `sandboxMode: "deferred"`. This is an alternative path where the gateway handles prebuild resolution.

**Files touched:** `apps/web/src/server/routers/cli.ts`, `apps/web/src/app/api/cli/sessions/route.ts`, `packages/services/src/cli/service.ts`

### 6.7 SSH Key Management

**What it does:** Generates, stores, and synchronizes SSH keys between CLI and server. **Status: Implemented**

**Client-side (CLI):**
- Key type: ed25519, no passphrase, comment `proliferate-cli`
- Generated via `ssh-keygen` subprocess (`packages/cli/src/lib/ssh.ts:generateSSHKey`)
- Stored at `~/.proliferate/id_ed25519` and `~/.proliferate/id_ed25519.pub`
- Fingerprint extracted via `ssh-keygen -lf` (SHA256 format)

**Server-side:**
- Public key stored in `user_ssh_keys` table with independently computed fingerprint
- Server fingerprint: `SHA256:<base64_no_padding(sha256(decoded_key_bytes))>` — base64 padding (`=`) is stripped (`packages/services/src/cli/service.ts:getSSHKeyFingerprint`)
- Unique constraint on fingerprint prevents duplicate key registration
- Keys are injected into sandbox at session creation via `provider.createTerminalSandbox()`

**Files touched:** `packages/cli/src/lib/ssh.ts`, `apps/web/src/server/routers/cli.ts:cliSshKeysRouter`, `packages/services/src/cli/service.ts`

### 6.8 GitHub Connection for CLI

**What it does:** Enables CLI sessions to access private GitHub repos via Nango OAuth. **Status: Implemented**

**Flow:**
1. CLI checks GitHub status via `cliGitHubRouter.status`
2. If not connected, starts OAuth via `cliGitHubRouter.connect` (creates Nango connect session)
3. User completes OAuth in browser
4. Web UI calls `cliGitHubRouter.select` to store the `connectionId` in `cli_github_selections` with 5-minute TTL
5. CLI polls `cliGitHubRouter.connectStatus` — checks `cli_github_selections` first, then falls back to querying Nango directly
6. On session creation, if `gitAuth=proliferate`, the GitHub token is fetched via the integration connection

**Files touched:** `apps/web/src/server/routers/cli.ts:cliGitHubRouter`, `packages/services/src/cli/service.ts`, `packages/db/src/schema/cli.ts:cliGithubSelections`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | CLI → Gateway | `createSyncClient`, `createOpenCodeClient` | Session creation and OpenCode attach via gateway SDK |
| `sandbox-providers.md` | Routes → Provider | `provider.createTerminalSandbox()` | CLI session route creates sandbox directly |
| `auth-orgs.md` | Routes → Auth | `auth.api.createApiKey()` | Device flow creates better-auth API key |
| `billing-metering.md` | Routes → Billing | `checkCanConnectCLI()`, `checkCanResumeSession()` | Billing gate before session creation |
| `integrations.md` | Routes → Nango | `nango.createConnectSession()` | GitHub OAuth for CLI |
| `repos-prebuilds.md` | Routes → Prebuilds | `provider.snapshot()` | CLI prebuild snapshots |

### Security & Auth
- Device codes expire after 15 minutes. Authorized codes are deleted after the API key is created.
- API keys created via device flow are non-expiring (`expiresIn: undefined`). Token revocation requires clearing `~/.proliferate/token` locally and revoking the key server-side.
- SSH private keys never leave the client machine. Only the public key is uploaded.
- Token file permissions are `0o600`; directory permissions are `0o700`.
- The `ApiClient` passes org ID via `X-Org-Id` header for organization context.

### Observability
- CLI API routes log via `@proliferate/logger` with `{ handler: "cli" }` context.
- CLI-side uses `console.error` with `chalk` for user-facing error messages (not structured logging — appropriate for a CLI tool).
- Session creation logs SSH key validation failures and sandbox creation errors.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] CLI compiles for all four platforms (`deno compile` targets)
- [ ] Device flow completes successfully (manual test)
- [ ] File sync transfers workspace to sandbox (manual test)
- [ ] This spec is updated (file tree, data models, route table)

---

## 9. Known Limitations & Tech Debt

- [ ] **Two session creation paths** — `cliSessionsRouter.create` (oRPC, creates sandbox directly) and `POST /api/cli/sessions` (standalone route, uses gateway SDK with deferred sandbox). Both exist and serve slightly different flows. Impact: confusing code paths for the same conceptual operation. Expected fix: consolidate to one path.
- [ ] **`ApiClient` partially redundant** — `packages/cli/src/lib/api.ts` defines an HTTP client for web API routes, but `main.ts` uses `@proliferate/gateway-clients` instead. The `ApiClient` class is still importable but the main flow doesn't use it. Impact: dead code confusion. Expected fix: remove or clearly mark as alternative client.
- [ ] **Empty `CONFIG_SYNC_JOBS`** — The config sync jobs array in `packages/cli/src/lib/sync.ts:256-258` is declared but empty. No config files (git config, SSH config) are synced to the sandbox. Impact: users may need to manually configure tools in the sandbox. Expected fix: add common dotfiles as sync targets.
- [ ] **No token rotation** — API keys created via device flow have no expiration. The only refresh mechanism is a health check that triggers full re-auth on failure. Impact: long-lived credentials. Expected fix: add token rotation or expiry.
- [ ] **No multi-org support in CLI** — The device flow captures the user's active org at authorization time. Switching orgs requires `proliferate reset` and re-authenticating. Impact: multi-org users must reset state. Expected fix: org selection during auth or a dedicated command.
- [ ] **Duplicate OpenCode binary resolution** — Both `packages/cli/src/lib/opencode.ts` and `packages/cli/src/agents/opencode.ts` contain `getOpenCodeBinaryPath()` with identical logic. Impact: maintenance burden. Expected fix: consolidate into single module.
