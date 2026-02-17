# Sandbox Providers — System Spec

## 1. Scope & Purpose

### In Scope
- `SandboxProvider` interface and provider contract
- Modal provider implementation (libmodal JS SDK)
- E2B provider implementation
- Modal image + deploy script (Python)
- Sandbox-MCP: API server, terminal WebSocket, service manager, auth, CLI setup
- Sandbox environment variable injection at boot
- OpenCode plugin injection (`PLUGIN_MJS` template string)
- Snapshot version key computation
- Snapshot resolution (which layers to use)
- Git freshness / pull cadence
- Port exposure (`proliferate services expose`)

### Out of Scope
- Session lifecycle that calls the provider — see `sessions-gateway.md`
- Tool schemas and prompt templates — see `agent-contract.md`
- Snapshot build jobs (base and repo snapshot workers) — see `repos-prebuilds.md`
- Secret values and bundle management — see `secrets-environment.md`
- LLM key generation — see `llm-proxy.md`

### Mental Model

A **sandbox** is a remote compute environment (Modal container or E2B sandbox) where the coding agent runs. This spec owns _how_ sandboxes are created, configured, and managed — the provider layer. The session lifecycle that _decides when_ to create or destroy sandboxes belongs to `sessions-gateway.md`.

The provider abstraction lets callers swap between Modal and E2B without code changes. Both providers perform the same boot sequence: resolve an image/template, create or recover a sandbox, clone repos (or restore from snapshot), inject config files + tools + plugin, start OpenCode, start infrastructure services, and start sandbox-mcp.

Inside every sandbox, **sandbox-mcp** runs as a sidecar providing an HTTP API (port 4000) and terminal WebSocket for the gateway to interact with the sandbox beyond OpenCode's SSE stream.

**Core entities:**
- **SandboxProvider** — The interface both Modal and E2B implement. Defined in `packages/shared/src/sandbox-provider.ts`.
- **sandbox-mcp** — The in-sandbox HTTP/WS server and CLI. Lives in `packages/sandbox-mcp/`.
- **Snapshot layers** — Three tiers: base snapshot (pre-baked image), repo snapshot (image + cloned repo), session/prebuild snapshot (full state). Resolved by `packages/shared/src/snapshot-resolution.ts`.

**Key invariants:**
- Providers must be stateless across calls. All state lives in the sandbox filesystem or metadata file (`/home/user/.proliferate/metadata.json`).
- `ensureSandbox()` is idempotent: recover an existing sandbox if alive, else create a new one.
- `terminate()` is idempotent: "not found" errors are treated as success.
- Secrets are never logged. Error messages pass through `redactSecrets()` before storage.

---

## 2. Core Concepts

### Provider Factory
Callers obtain a provider via `getSandboxProvider(type?)` (`packages/shared/src/providers/index.ts`). If no `type` is passed, it reads `DEFAULT_SANDBOX_PROVIDER` from the environment schema (`packages/environment/src/schema.ts`). The provider type is persisted in the session DB record (`sessions.sandbox_provider`) so that resume always uses the same provider that created the sandbox. A thin alias `getSandboxProviderForSnapshot()` exists but is currently unused — gateway code calls `getSandboxProvider(providerType)` directly.
- Key detail agents get wrong: Session-facing code (gateway, API routes) should go through the factory — not instantiate providers directly. However, snapshot build workers (`apps/worker/src/base-snapshots/`, `apps/worker/src/repo-snapshots/`) and the CLI snapshot script (`apps/gateway/src/bin/create-modal-base-snapshot.ts`) instantiate `ModalLibmodalProvider` directly because they need provider-specific methods like `createBaseSnapshot()` / `createRepoSnapshot()` that aren't on the `SandboxProvider` interface.
- Reference: `packages/shared/src/providers/index.ts`

### SandboxProvider Interface
The common contract for all providers. Defines required methods (`ensureSandbox`, `createSandbox`, `snapshot`, `pause`, `terminate`, `writeEnvFile`, `health`) and optional methods (`checkSandboxes`, `resolveTunnels`, `testServiceCommands`, `execCommand`).
- Key detail agents get wrong: `ensureSandbox` is the preferred entry point, not `createSandbox`. The former handles recovery; the latter always creates fresh.
- Reference: `packages/shared/src/sandbox-provider.ts`

### Agent & Model Configuration
The `AgentConfig` type (`packages/shared/src/agents.ts`) carries agent type and model ID through the stack. The default is `opencode` agent with `claude-opus-4.6` model. Model IDs are canonical (e.g., `"claude-opus-4.6"`) and transformed to provider-specific formats: `toOpencodeModelId()` produces `"anthropic/claude-opus-4-6"` for OpenCode's config file.
- Key detail agents get wrong: OpenCode model IDs have NO date suffix — OpenCode handles the mapping internally. Don't use Anthropic API format (`claude-opus-4-6-20250514`) in OpenCode config.
- Reference: `packages/shared/src/agents.ts:toOpencodeModelId`

### Snapshot Layering
Sandboxes can start from three levels of pre-built state: (1) base snapshot — OpenCode + services pre-installed, no repo; (2) repo snapshot — base + cloned repo; (3) session/prebuild snapshot — full working state. The `resolveSnapshotId()` function picks the best available layer.
- Key detail agents get wrong: Repo snapshots are only used for Modal provider, single-repo, `workspacePath = "."`. E2B sessions skip this layer.
- Reference: `packages/shared/src/snapshot-resolution.ts`

### Git Freshness
When restoring from a snapshot, repos may be stale. The `shouldPullOnRestore()` function gates `git pull --ff-only` on: (1) feature flag `SANDBOX_GIT_PULL_ON_RESTORE`, (2) having a snapshot, (3) cadence timer `SANDBOX_GIT_PULL_CADENCE_SECONDS`.
- Key detail agents get wrong: Cadence is only advanced when _all_ repo pulls succeed. A single failure leaves the timer unchanged so the next restore retries.
- Reference: `packages/shared/src/sandbox/git-freshness.ts`

### OpenCode Plugin (PLUGIN_MJS)
A minimal ESM plugin injected into every sandbox at `~/.config/opencode/plugin/proliferate.mjs`. It exports a `ProliferatePlugin` async function with empty hooks. All event streaming flows via SSE (gateway pulls from OpenCode) — the plugin does NOT push events.
- Key detail agents get wrong: The `console.log` calls inside `PLUGIN_MJS` run _inside the sandbox_, not in the provider. They are template string literals, not actual server-side calls. Do not migrate them to structured logging.
- Reference: `packages/shared/src/sandbox/config.ts:PLUGIN_MJS`

---

## 3. File Tree

```
packages/shared/src/
├── sandbox-provider.ts              # SandboxProvider interface + all types
├── snapshot-resolution.ts           # resolveSnapshotId() — snapshot layer picker
├── agents.ts                        # AgentConfig, ModelId, toOpencodeModelId()
├── sandbox/
│   ├── index.ts                     # Barrel export
│   ├── config.ts                    # PLUGIN_MJS, DEFAULT_CADDYFILE, SANDBOX_PATHS/PORTS, env instructions, service command parsing
│   ├── opencode.ts                  # getOpencodeConfig(), waitForOpenCodeReady(), SessionMetadata
│   ├── git-freshness.ts             # shouldPullOnRestore()
│   ├── version-key.ts              # computeBaseSnapshotVersionKey()
│   ├── errors.ts                    # SandboxProviderError, redactSecrets()
│   └── fetch.ts                     # fetchWithTimeout(), providerFetch(), DEFAULT_TIMEOUTS
├── providers/
│   ├── index.ts                     # getSandboxProvider() factory, getSandboxProviderForSnapshot()
│   ├── modal-libmodal.ts            # ModalLibmodalProvider (default)
│   └── e2b.ts                       # E2BProvider

packages/sandbox-mcp/src/
├── index.ts                         # Entry point — starts API server + terminal WS
├── api-server.ts                    # Express HTTP API on port 4000
├── terminal.ts                      # PTY-over-WebSocket at /api/terminal
├── service-manager.ts               # Start/stop/expose services, state persistence
├── auth.ts                          # Bearer token validation
├── types.ts                         # ServiceInfo, State types
├── proliferate-cli.ts               # `proliferate` CLI (services, env, actions)
├── actions-grants.ts                # Grant request/list command handlers
├── actions-grants.test.ts           # Tests for grant handlers
└── proliferate-cli-env.test.ts      # Tests for env apply/scrub

packages/modal-sandbox/
├── deploy.py                        # Modal app definition + get_image_id endpoint
└── Dockerfile                       # Base sandbox image
```

---

## 4. Data Models & Schemas

### Core TypeScript Types

```typescript
// packages/shared/src/sandbox-provider.ts
type SandboxProviderType = "modal" | "e2b";

interface CreateSandboxOpts {
  sessionId: string;
  repos: RepoSpec[];           // Always an array, even for single repo
  branch: string;
  envVars: Record<string, string>;
  systemPrompt: string;
  snapshotId?: string;         // Restore from this snapshot
  baseSnapshotId?: string;     // Use as base layer (skip get_image_id)
  agentConfig?: AgentConfig;
  currentSandboxId?: string;   // For ensureSandbox recovery (E2B)
  sshPublicKey?: string;
  triggerContext?: Record<string, unknown>;
  snapshotHasDeps?: boolean;   // Gates service command auto-start
  serviceCommands?: PrebuildServiceCommand[];
  envFiles?: unknown;          // Env file generation spec
  sessionType?: "coding" | "setup" | "cli" | null;  // Controls tool injection
}

interface CreateSandboxResult {
  sandboxId: string;
  tunnelUrl: string;           // OpenCode API URL
  previewUrl: string;          // Caddy preview proxy URL
  sshHost?: string;
  sshPort?: number;
  expiresAt?: number;          // Epoch ms
}

// packages/shared/src/sandbox/opencode.ts
interface SessionMetadata {
  sessionId: string;
  repoDir: string;
  createdAt: number;
  lastGitFetchAt?: number;     // Used by cadence gate
}

// packages/sandbox-mcp/src/types.ts
interface ServiceInfo {
  name: string;
  command: string;
  cwd: string;
  pid: number;
  status: "running" | "stopped" | "error";
  startedAt: number;
  logFile: string;
}
```

### Sandbox Filesystem Layout

```
/home/user/
├── .config/opencode/
│   ├── opencode.json                # Global OpenCode config
│   └── plugin/proliferate.mjs       # Proliferate SSE plugin
├── .proliferate/
│   ├── metadata.json                # SessionMetadata (repoDir, cadence)
│   ├── actions-guide.md             # Actions bootstrap hint
│   └── caddy/user.caddy             # User port expose snippet
├── .env.proliferate                 # Environment profile (E2B resume)
├── .opencode-tools/                 # Pre-installed tool node_modules
├── Caddyfile                        # Main Caddy config
└── workspace/                       # Cloned repos live here
    ├── .opencode/
    │   ├── instructions.md          # System prompt + env instructions
    │   └── tool/                    # OpenCode custom tools (verify, save_snapshot, etc.)
    ├── opencode.json                # Local OpenCode config (copy of global)
    └── .proliferate/
        └── trigger-context.json     # Automation trigger context (if applicable)
```

### Standard Ports

| Port | Service | Encrypted | Reference |
|------|---------|-----------|-----------|
| 4096 | OpenCode API | Yes (HTTPS) | `SANDBOX_PORTS.opencode` |
| 20000 | Caddy preview proxy | Yes (HTTPS) | `SANDBOX_PORTS.preview` |
| 22 | SSH (CLI sessions) | No (raw TCP) | `SANDBOX_PORTS.ssh` |
| 3901 | openvscode-server | Proxied via Caddy | `SANDBOX_PORTS.vscode` |
| 4000 | sandbox-mcp API | Internal only | `api-server.ts` |

### Environment Variables (`packages/environment/src/schema.ts`)

| Variable | Type | Default | Required | Notes |
|----------|------|---------|----------|-------|
| `DEFAULT_SANDBOX_PROVIDER` | `"modal" \| "e2b"` | — | Yes | Selects active provider |
| `SANDBOX_TIMEOUT_SECONDS` | int | `3600` | No | Max sandbox lifetime |
| `SANDBOX_GIT_PULL_ON_RESTORE` | boolean | `false` | No | Enable git pull on snapshot restore |
| `SANDBOX_GIT_PULL_CADENCE_SECONDS` | int (>=0) | `0` | No | Min seconds between pulls; 0 = always |
| `MODAL_APP_NAME` | string | — | If modal | Modal app name |
| `MODAL_APP_SUFFIX` | string | — | No | Per-developer suffix (e.g., `"pablo"`) |
| `MODAL_BASE_SNAPSHOT_ID` | string | — | No | Pre-baked base snapshot image ID |
| `MODAL_TOKEN_ID` | string | — | If modal | `ak-...` format |
| `MODAL_TOKEN_SECRET` | string | — | If modal | `as-...` format |
| `MODAL_ENDPOINT_URL` | string | — | No | Test/custom endpoint only |
| `E2B_API_KEY` | string | — | If e2b | E2B API key |
| `E2B_DOMAIN` | string | — | If e2b | Self-hosted E2B domain |
| `E2B_TEMPLATE` | string | — | If e2b | E2B template ID |
| `E2B_TEMPLATE_ALIAS` | string | — | If e2b | E2B template alias |

Note: `SANDBOX_MCP_AUTH_TOKEN` is NOT in the environment schema — it's injected by the provider into the sandbox at boot via `CreateSandboxOpts.envVars` and read from `process.env` inside the sandbox.

### Base Sandbox Image (`packages/modal-sandbox/Dockerfile`)

The Dockerfile builds an Ubuntu 22.04 image with:

| Category | Contents |
|----------|----------|
| **Languages** | Node.js 20 (pnpm, yarn), Python 3.11 (uv, pip) |
| **AI Agents** | OpenCode |
| **Sandbox Tooling** | `proliferate-sandbox-mcp` (npm global) |
| **Docker** | Docker CE 27.5.0, Compose plugin, Buildx, runc 1.3.0 |
| **Web** | Caddy (preview proxy), openvscode-server 1.106.3 |
| **Git** | Git, GitHub CLI (`gh`), custom credential helpers (`git-credential-proliferate`, `git-askpass`) |
| **System** | SSH server (key-only auth), rsync, tmux, jq, procps |
| **Scripts** | `start-services.sh` (sshd), `start-dockerd.sh` (Docker daemon with iptables NAT), `proliferate-info` |
| **User** | Non-root `user` with passwordless sudo |
| **Pre-installed** | `@aws-sdk/client-s3` + `@opencode-ai/plugin` at `/home/user/.opencode-tools/` |

---

## 5. Conventions & Patterns

### Do
- Use `ensureSandbox()` for session initialization — it handles recovery automatically.
- Pass environment variables via `CreateSandboxOpts.envVars` — providers handle injection.
- Use `shellEscape()` for any user-provided values in shell commands (`packages/shared/src/sandbox/config.ts:shellEscape`).
- Wrap errors with `SandboxProviderError.fromError()` to ensure secret redaction.
- Use `capOutput()` to truncate command output to 16KB before logging.

### Don't
- Don't call `createSandbox()` directly unless you explicitly want a fresh sandbox.
- Don't log raw `envVars` or API keys — they contain secrets.
- Don't assume sandbox filesystem state persists after `terminate()`.
- Don't migrate `console.log` in `PLUGIN_MJS` — it's a template string that runs inside sandboxes.

### Error Handling

```typescript
// packages/shared/src/sandbox/errors.ts
// Modal wraps errors consistently:
throw SandboxProviderError.fromError(error, "modal", "createSandbox");
// Redacts API keys, tokens, JWTs from messages automatically
```

**Caveat:** E2B's `createSandbox` throws raw `Error` for validation failures (missing repos, missing template) at `e2b.ts:226-242`. Only `terminate` and `pause` wrap with `SandboxProviderError`. Modal is more consistent in wrapping.

### Reliability
- **Timeouts**: Sandbox lifetime defaults to 3600s (`SANDBOX_TIMEOUT_SECONDS`). OpenCode readiness poll: 30s with exponential backoff (200ms base, 1.5x, max 2s). Both providers use their respective SDK calls (libmodal / E2B SDK) — not the `fetchWithTimeout()`/`providerFetch()` utilities in `packages/shared/src/sandbox/fetch.ts`. Those utilities and `DEFAULT_TIMEOUTS` are exported but currently unused by provider implementations.
- **Retries**: `proliferate` CLI retries API calls up to 10 times with 1s delay for `ECONNREFUSED`/`fetch failed` (`proliferate-cli.ts:fetchWithRetry`).
- **Idempotency**: `terminate()` treats "not found" as success. `ensureSandbox()` recovers existing sandboxes.

### Testing Conventions
- Grant command handlers are extracted into `actions-grants.ts` with injectable dependencies for pure unit testing.
- Env apply/scrub logic tested in `proliferate-cli-env.test.ts`.
- Snapshot resolution is a pure function — unit test `resolveSnapshotId()` directly.

---

## 6. Subsystem Deep Dives

### 6.1 Provider Factory — `Implemented`

**What it does:** Selects and instantiates the correct provider based on configuration.

**Happy path** (`packages/shared/src/providers/index.ts:getSandboxProvider`):
1. Accept optional `type` parameter (e.g., from session DB record).
2. Fall back to `env.DEFAULT_SANDBOX_PROVIDER` if no type given.
3. Look up factory in `providers` map (`{ modal: () => new ModalLibmodalProvider(), e2b: () => new E2BProvider() }`).
4. Return fresh provider instance (providers are stateless — new instance per call).

**Usage in gateway:**
- Session creation: `getSandboxProvider()` — uses default from env (`apps/gateway/src/api/proliferate/http/sessions.ts`).
- Session resume/runtime: `getSandboxProvider(session.sandbox_provider)` — uses type from DB record (`apps/gateway/src/hub/session-runtime.ts`).
- Snapshot operations: `getSandboxProvider(providerType)` — uses type from session/snapshot record (`apps/gateway/src/hub/session-hub.ts`).

**Files touched:** `packages/shared/src/providers/index.ts`

### 6.2 Provider: Modal (ModalLibmodalProvider) — `Implemented`

**What it does:** Creates sandboxes using the Modal JS SDK (`libmodal`). Default provider.

**Happy path (createSandbox):**
1. Authenticate with Modal API via `ensureModalAuth()` — validates token format before calling API (`modal-libmodal.ts:160`).
2. Resolve sandbox image: restore snapshot > base snapshot (`MODAL_BASE_SNAPSHOT_ID`) > base image (via `get_image_id` endpoint) (`modal-libmodal.ts:541-565`).
3. Build env vars: inject `SESSION_ID`, LLM proxy config (`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`), and user-provided vars (`modal-libmodal.ts:586-612`).
4. Create sandbox with `client.sandboxes.create()` — Docker enabled, 2 CPU, 4GB RAM, encrypted ports for OpenCode+preview, unencrypted for SSH (`modal-libmodal.ts:621-631`).
5. Get tunnel URLs via `sandbox.tunnels(30000)` (`modal-libmodal.ts:642-656`).
6. **Essential setup (blocking)**: Clone repos, write plugin/tools/config/instructions, start OpenCode server (`modal-libmodal.ts:662-678`).
7. **Additional setup (async)**: Git freshness pull, start services (sshd), start Caddy, start sandbox-mcp, boot service commands (`modal-libmodal.ts:691`).
8. Wait for OpenCode readiness (poll `/session` endpoint, 30s timeout) (`modal-libmodal.ts:701`).

**Edge cases:**
- Branch clone fails → falls back to default branch (`modal-libmodal.ts:909-919`).
- Memory snapshot restore now blocks on OpenCode readiness (`waitForOpenCodeReady`) before returning tunnel URLs, preventing post-restore `/session` races.
- Modal does not support `pause()` — throws `SandboxProviderError` (`modal-libmodal.ts:1496`).
- `findSandbox()` uses `sessionId` as Modal sandbox name for 1:1 lookup (`modal-libmodal.ts:810`).

**Files touched:** `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/sandbox/config.ts`, `packages/shared/src/sandbox/opencode.ts`

### 6.3 Provider: E2B (E2BProvider) — `Implemented`

**What it does:** Creates sandboxes using the E2B TypeScript SDK. Supports pause/resume natively.

**Happy path (createSandbox):**
1. Build env vars (same pattern as Modal) (`e2b.ts:119-148`).
2. If snapshot: `Sandbox.connect(snapshotId)` auto-resumes paused sandbox. Re-injects env vars via JSON file + `jq` export (`e2b.ts:165-209`).
3. If fresh: `Sandbox.create(E2B_TEMPLATE, opts)` with configured timeout (`e2b.ts:222-238`).
4. Setup workspace, essential deps, additional deps (same sequence as Modal).
5. Get tunnel URLs via `sandbox.getHost(port)` (`e2b.ts:288-292`).
6. Wait for OpenCode readiness (`e2b.ts:304-325`).

**Key differences from Modal:**
- `supportsPause = true`, `supportsAutoPause = true` — E2B can pause/resume sandboxes (`e2b.ts:93-94`).
- `pause()` calls `Sandbox.betaPause()`. The `sandboxId` itself becomes the snapshot ID (`e2b.ts:960-975`).
- `snapshot()` maps 1:1 to `pause()` (`e2b.ts:955-958`).
- `findSandbox()` uses `currentSandboxId` from DB (E2B auto-generates IDs) (`e2b.ts:406-417`).
- `checkSandboxes()` uses `Sandbox.list()` — side-effect free, doesn't resume paused sandboxes (`e2b.ts:1199-1238`).
- Snapshot resume failures fall back to fresh sandbox creation (`e2b.ts:210-219`).

**Files touched:** `packages/shared/src/providers/e2b.ts`

### 6.4 Sandbox Boot Sequence — `Implemented`

**What it does:** Both providers follow the same two-phase boot sequence after sandbox creation.

**Phase 1 — Essential (blocking):**
1. Clone repos (or read metadata from snapshot) — `setupSandbox()`. For scratch sessions (`repos: []`), cloning is skipped and the workspace defaults to `/workspace/`.
2. Write config files in parallel: plugin, tool pairs (.ts + .txt), OpenCode config (global + local), instructions.md, actions-guide.md, pre-installed tool deps. **Setup-only tools** (`save_service_commands`, `save_env_files`) are only written when `opts.sessionType === "setup"` — coding/CLI sessions never see them.
3. **Modal only:** Write SSH keys if CLI session (`modal-libmodal.ts:1062`), write trigger context if automation-triggered (`modal-libmodal.ts:1071`). E2B does not handle SSH or trigger context.
4. Start OpenCode server (`opencode serve --port 4096`).

**Phase 2 — Additional (fire-and-forget):**
1. Git freshness pull (if enabled and cadence elapsed).
2. Start infrastructure services (`/usr/local/bin/start-services.sh` — sshd for Modal, Docker daemon for E2B).
3. Create Caddy import directory, write Caddyfile, start Caddy.
5. Start sandbox-mcp API server (`sandbox-mcp api`, port 4000).
6. Apply env files via `proliferate env apply` (blocking within phase 2).
7. Start service commands via `proliferate services start` (fire-and-forget).

**Files touched:** Both provider files, `packages/shared/src/sandbox/config.ts`

### 6.5 Snapshot Resolution — `Implemented`

**What it does:** Pure function that picks the best snapshot for a session.

**Priority chain** (`packages/shared/src/snapshot-resolution.ts:resolveSnapshotId`):
1. **Prebuild/session snapshot** (`prebuildSnapshotId`) — always wins if present.
2. **Repo snapshot** — only for Modal provider, single-repo, `workspacePath = "."`, status `"ready"`.
3. **No snapshot** — start from base image with live clone.

**Edge cases:**
- Multi-repo prebuilds never use repo snapshots (returns `null`).
- Unknown/null provider skips repo snapshot layer.
- Repo snapshot must have matching provider (`"modal"` or null).

### 6.6 Snapshot Version Key — `Implemented`

**What it does:** Computes a SHA-256 hash of everything baked into a base snapshot (`packages/shared/src/sandbox/version-key.ts:computeBaseSnapshotVersionKey`).

**Inputs hashed:** `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)`.

When this key changes, the base snapshot is stale and must be rebuilt. Used by snapshot build workers (see `repos-prebuilds.md`).

### 6.7 Git Freshness — `Implemented`

**What it does:** Decides whether to `git pull --ff-only` when restoring from snapshot.

**Decision function** (`packages/shared/src/sandbox/git-freshness.ts:shouldPullOnRestore`):
- Returns `false` if: disabled, no snapshot, no repos, or cadence window hasn't elapsed.
- Returns `true` if: cadence is 0 (always), no `lastGitFetchAt` (legacy), or enough time has passed.

**Env vars:** `SANDBOX_GIT_PULL_ON_RESTORE` (boolean), `SANDBOX_GIT_PULL_CADENCE_SECONDS` (number, 0 = always).

Both providers re-write git credentials before pulling (snapshot tokens may be stale) and only advance the cadence timer when all pulls succeed.

### 6.8 Sandbox-MCP API Server — `Implemented`

**What it does:** Express HTTP server on port 4000 inside the sandbox. Routed externally via Caddy at `/_proliferate/mcp/*`.

**Endpoints** (`packages/sandbox-mcp/src/api-server.ts`):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | No | Health check |
| GET | `/api/auth/check` | Yes | Caddy forward_auth for VS Code |
| GET | `/api/services` | Yes | List services + exposed port |
| POST | `/api/services` | Yes | Start a service |
| DELETE | `/api/services/:name` | Yes | Stop a service |
| POST | `/api/expose` | Yes | Expose port via Caddy |
| GET | `/api/logs/:name` | Yes | Stream service logs (SSE) |
| GET | `/api/git/repos` | Yes | Discover git repos in workspace |
| GET | `/api/git/status` | Yes | Git status (porcelain v2) |
| GET | `/api/git/diff` | Yes | Git diff (capped at 64KB) |

**Security:** All endpoints except `/api/health` require `Authorization: Bearer <token>` validated against `SANDBOX_MCP_AUTH_TOKEN` (falls back to `SERVICE_TO_SERVICE_AUTH_TOKEN`) (`packages/sandbox-mcp/src/auth.ts`). Repo ID is base64-encoded path, validated against workspace directory to prevent traversal.

### 6.9 Terminal WebSocket — `Implemented`

**What it does:** Interactive bash PTY over WebSocket at `/api/terminal`.

**Protocol** (`packages/sandbox-mcp/src/terminal.ts`):
- Auth: `Authorization: Bearer <token>` header on WS upgrade (no query-param auth).
- Client sends text frames (keystrokes) or JSON `{ type: "resize", cols, rows }`.
- Server sends PTY output as text frames.
- Spawns `bash` with `xterm-256color` terminal, cwd = `WORKSPACE_DIR`.

### 6.10 Service Manager — `Implemented`

**What it does:** Manages long-running processes inside the sandbox with state persistence.

**Key behaviors** (`packages/sandbox-mcp/src/service-manager.ts`):
- State persisted to `/tmp/proliferate/state.json`. Logs to `/tmp/proliferate/logs/<name>.log`.
- `startService()`: kills existing service with same name (handles both in-memory and orphaned PIDs via process group kill), spawns new process detached.
- `stopService()`: SIGTERM to process group (negative PID).
- `exposePort()`: writes Caddy snippet to `/home/user/.proliferate/caddy/user.caddy`, reloads Caddy via `pkill -USR1 caddy`. The snippet's `handle` block takes priority over the default multi-port fallback in the main Caddyfile.
- Process exit updates state (`stopped` on code 0, `error` otherwise).

### 6.11 Proliferate CLI — `Implemented`

**What it does:** CLI tool available inside sandboxes as `proliferate`. Provides subcommands for services, env, and actions.

**Command groups** (`packages/sandbox-mcp/src/proliferate-cli.ts`):

| Group | Command | Description |
|-------|---------|-------------|
| `services` | `list/start/stop/restart/expose/logs` | Manage sandbox services via sandbox-mcp API |
| `env` | `apply --spec <json>` | Generate env files from spec + process.env + `/tmp/.proliferate_env.json` overrides |
| `env` | `scrub --spec <json>` | Delete secret env files |
| `actions` | `list` | List available integrations (calls gateway) |
| `actions` | `guide --integration <i>` | Show provider usage guide (calls gateway) |
| `actions` | `run --integration <i> --action <a>` | Execute action, poll for approval if write (calls gateway) |
| `actions` | `grant request/grants list` | Request/list grants (calls gateway) |

**Env apply** adds generated files to `.git/info/exclude` automatically. Resolves values from process.env with `/tmp/.proliferate_env.json` overrides. Two-pass: validates all required keys exist before writing any files.

### 6.12 Modal Image + Deploy — `Implemented`

**What it does:** Python script that registers the Modal app and exposes a `get_image_id` endpoint.

**How it works** (`packages/modal-sandbox/deploy.py`):
- Builds image from `Dockerfile` using `modal.Image.from_dockerfile()`.
- Exposes `GET get_image_id` — returns `{"image_id": BASE_IMAGE.object_id}`. Called once by the TS provider at startup to resolve the base image.
- Exposes `GET health` — returns `{"status": "ok"}`.
- Supports per-developer deployments via `MODAL_APP_SUFFIX` env var (e.g., `proliferate-sandbox-pablo`).

**Deploy:** `cd packages/modal-sandbox && modal deploy deploy.py`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions/Gateway | Gateway → Provider | `SandboxProvider.ensureSandbox()` | Gateway calls provider to create/recover sandboxes. See `sessions-gateway.md`. |
| Agent Contract | Provider → Sandbox | Tool files written to `.opencode/tool/` | Provider injects tool implementations at boot. Tool schemas defined in `agent-contract.md`. |
| Repos/Prebuilds | Provider ← Worker | `createBaseSnapshot()`, `createRepoSnapshot()` | Snapshot workers call Modal provider directly. See `repos-prebuilds.md`. |
| Secrets/Environment | Provider ← Gateway | `CreateSandboxOpts.envVars` | Gateway assembles env vars from secrets. See `secrets-environment.md`. |
| LLM Proxy | Provider → Sandbox | `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` env vars | Virtual key injected as env var. See `llm-proxy.md`. |
| Actions | CLI → Gateway | `proliferate actions run` | CLI calls gateway action endpoints. See `actions.md`. |

### Security & Auth
- **sandbox-mcp auth**: Bearer token via `SANDBOX_MCP_AUTH_TOKEN` env var (falls back to `SERVICE_TO_SERVICE_AUTH_TOKEN`). Secure-by-default — returns `false` if no token configured (`packages/sandbox-mcp/src/auth.ts`).
- **Secret redaction**: `SandboxProviderError` auto-redacts API keys, tokens, JWTs from error messages via regex patterns (`packages/shared/src/sandbox/errors.ts:redactSecrets`).
- **Git credentials**: Written to `/tmp/.git-credentials.json`. Credentials DO persist in snapshots but become stale — both providers re-write with fresh tokens inside the `if (doPull)` block on restore (`modal-libmodal.ts:1178`, `e2b.ts:842`).
- **Path traversal prevention**: sandbox-mcp validates all repo paths stay within workspace directory, dereferencing symlinks (`api-server.ts:validateInsideWorkspace`).

### Observability
- Both providers use structured logging via `@proliferate/logger` with `{ module: "modal" | "e2b" }` child loggers.
- Latency events logged at every step: `provider.create_sandbox.start`, `provider.create_sandbox.auth_ok`, `provider.create_sandbox.sandbox_created`, `provider.create_sandbox.tunnels`, `provider.create_sandbox.opencode_ready`, `provider.create_sandbox.complete`.
- sandbox-mcp uses `createLogger({ service: "sandbox-mcp" })`.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/sandbox-mcp` tests pass (`pnpm -C packages/sandbox-mcp test`)
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] No secrets or API keys in error messages (check `redactSecrets` coverage)

---

## 9. Known Limitations & Tech Debt

- [ ] **Modal does not support pause** — `pause()` throws (`modal-libmodal.ts:1496`). Sessions on Modal must snapshot + terminate, then create fresh from snapshot on resume. No impact on correctness but slower than E2B's native pause/resume.
- [ ] **E2B snapshot resume fallback** — If `Sandbox.connect()` fails on a paused sandbox, E2B falls back to fresh creation silently. This loses the snapshot state without user notification.
- [ ] **Stale git credentials in snapshots** — Credentials persist in snapshots at `/tmp/.git-credentials.json` but may be expired. Both providers only re-write credentials when git pull is actually performed (inside the `if (doPull)` block). If cadence gate says no pull, stale credentials remain until the next pull window.
- [ ] **Service manager state in /tmp** — Process state is stored in `/tmp/proliferate/state.json`. This survives within a session but is lost on Modal sandbox recreation. E2B pause/resume preserves it.
- [ ] **No health monitoring for sandbox-mcp** — If sandbox-mcp crashes after boot, there's no automatic restart. The process runs fire-and-forget.
- [ ] **Caddy fallback ports hardcoded** — The default Caddyfile tries ports 3000, 5173, 8000, 4321 in order. No mechanism to configure this per-prebuild without using `exposePort()`.
