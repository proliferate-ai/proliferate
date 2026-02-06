# Sandbox Providers Spec: E2B + Modal

Last updated: 2026-02-02

## Relevant Files (Quick Map)

```
apps/
├── gateway/
│   └── src/
│       └── hub/
│           ├── session-runtime.ts
│           └── capabilities/
│               └── tools/
│                   └── verify.ts
└── web/
    └── src/
        └── server/
            └── routers/
                ├── sessions-create.ts
                ├── sessions-pause.ts
                ├── sessions-snapshot.ts
                └── sessions-submit-env.ts

packages/
├── e2b-sandbox/
│   ├── build.ts
│   ├── e2b.Dockerfile
│   └── template.ts
├── modal-sandbox/
│   ├── deploy.py
│   └── Dockerfile
├── sandbox-mcp/
│   └── src/
│       └── service-manager.ts
└── shared/
    └── src/
        ├── opencode-tools/
        │   └── index.ts
        ├── providers/
        │   ├── e2b.ts
        │   ├── index.ts
        │   ├── modal-libmodal.ts
        │   └── provider-contract.test.ts
        └── sandbox/
            ├── config.ts
            └── opencode.ts

packages/shared/src/sandbox-provider.ts
```

## Scope
This document describes the sandbox provider implementations (E2B and Modal), how they are wired into the product, and the end-to-end lifecycle flows (create/ensure/snapshot/pause/terminate/verify). It also documents the shared OpenCode/MCP configuration and sandbox image build pipelines.

## Goals
- Provide a single reference for how sandboxes are created and managed.
- Explain the parity contract between E2B and Modal providers.
- List key files and their responsibilities.

## Non-Goals
- UI/UX details beyond what is needed to understand sandbox flow.
- Detailed infra/provisioning guides (see docs/SELF_HOSTING.md).

---

## Component Map (Key Files)

### Shared Contracts and Utilities
- `packages/shared/src/sandbox-provider.ts`
  - Provider interface and data types (`CreateSandboxOpts`, `CreateSandboxResult`, `SnapshotResult`, etc.).
- `packages/shared/src/providers/index.ts`
  - Provider selector (`getSandboxProvider`) and environment-based defaults.
- `packages/shared/src/sandbox/config.ts`
  - Standard paths and ports (`SANDBOX_PATHS`, `SANDBOX_PORTS`) and timeout config.
- `packages/shared/src/sandbox/opencode.ts`
  - Generates `opencode.json` config, OpenCode readiness checks, MCP configuration.
- `packages/shared/src/opencode-tools/index.ts`
  - Tool definitions injected into sandboxes (`verify`, `save_snapshot`, `request_env_variables`).
- `packages/shared/src/providers/provider-contract.test.ts`
  - Behavioral parity tests across providers.

### E2B Provider
- `packages/shared/src/providers/e2b.ts`
  - E2B provider implementation (create/ensure/pause/snapshot/readFiles/etc).
- `packages/e2b-sandbox/e2b.Dockerfile`
  - E2B image build; installs OpenCode, MCP servers, and start scripts.
- `packages/e2b-sandbox/template.ts`
  - E2B template wrapper for the Dockerfile.
- `packages/e2b-sandbox/build.ts`
  - Builds the E2B template (alias, resources, optional self-hosted domain).

### Modal Provider
- `packages/shared/src/providers/modal-libmodal.ts`
  - Modal provider implementation using the JS SDK (libmodal).
- `packages/modal-sandbox/Dockerfile`
  - Modal image build; installs OpenCode, MCP servers, start scripts.
- `packages/modal-sandbox/deploy.py`
  - Minimal Modal app exposing `get_image_id` for the TS provider.

### MCP Server
- `packages/sandbox-mcp/src/service-manager.ts`
  - Service management and Caddy exposure; respects `WORKSPACE_DIR`.

### Runtime Orchestration
- `apps/web/src/server/routers/sessions-create.ts`
  - Session creation, env setup, and `provider.createSandbox`.
- `apps/web/src/server/routers/sessions-pause.ts`
  - Pause/snapshot requests per provider.
- `apps/web/src/server/routers/sessions-snapshot.ts`
  - Explicit snapshot endpoint.
- `apps/web/src/server/routers/sessions-submit-env.ts`
  - User-submitted env var handling.
- `apps/gateway/src/hub/session-runtime.ts`
  - Ensure/resume logic (`provider.ensureSandbox`).
- `apps/gateway/src/hub/capabilities/tools/verify.ts`
  - Gateway intercept for `verify()` uploads.

---

## Shared Abstractions

### SandboxProvider Contract
File: `packages/shared/src/sandbox-provider.ts`
- Providers must implement:
  - `createSandbox`, `ensureSandbox`, `snapshot`, `pause`, `terminate`
  - `writeEnvFile`, `health`, `resolveTunnels`, `readFiles` (optional)
  - `checkSandboxes` (optional)
- Parity is enforced by tests in `packages/shared/src/providers/provider-contract.test.ts`.

### Standard Paths and Ports
File: `packages/shared/src/sandbox/config.ts`
- Paths are standardized across providers:
  - Home: `/home/user`
  - Global OpenCode config: `/home/user/.config/opencode/opencode.json`
  - Global plugin dir: `/home/user/.config/opencode/plugin`
  - Metadata: `/home/user/.proliferate/metadata.json`
  - Preinstalled tools: `/home/user/.opencode-tools`
- Ports:
  - OpenCode: 4096
  - Preview (Caddy): 20000
  - SSH: 22

### OpenCode Configuration + MCP
File: `packages/shared/src/sandbox/opencode.ts`
- Generates `opencode.json` with:
  - Model/provider config (with optional LLM proxy)
  - Plugin loading (`proliferate.mjs`)
  - MCP servers:
    - `playwright` (browser automation)
    - `sandbox_mcp` (service manager)
- `sandbox_mcp` gets `WORKSPACE_DIR` injected based on `SANDBOX_PATHS.home`.

### OpenCode Tools
File: `packages/shared/src/opencode-tools/index.ts`
- Tool stubs injected into `.opencode/tool/`:
  - `request_env_variables` (UI-backed env input)
  - `verify` (gateway-intercepted evidence upload)
  - `save_snapshot`
- Env file location: `/tmp/.proliferate_env.json` (constant `ENV_FILE`).

---

## Provider Selection
File: `packages/shared/src/providers/index.ts`
- `getSandboxProvider(type?)` uses `DEFAULT_SANDBOX_PROVIDER` or defaults to `modal`.
- Session records store `sandboxProvider` to ensure the same provider is reused for restore/resume flows.

---

## Core Flows

### 1) Session Creation (Web API)
File: `apps/web/src/server/routers/sessions-create.ts`
1. Resolve repos + tokens, compute system prompt, create session record.
2. Construct env vars (LLM proxy key if enabled; otherwise direct Anthropic key).
3. `provider.createSandbox({ sessionId, repos, envVars, systemPrompt, snapshotId?, agentConfig })`.
4. Persist sandbox/tunnel info in DB.
5. For setup sessions: take an initial snapshot async.

### 2) Ensure/Resume (Gateway)
File: `apps/gateway/src/hub/session-runtime.ts`
1. Load session context from DB (repos, env vars, snapshot info).
2. Select provider from session record.
3. Call `provider.ensureSandbox(...)` with `currentSandboxId` and `snapshotId`.
4. Update session record with live tunnels + expiration.
5. For setup sessions, optionally take early snapshots.

### 3) Snapshot / Pause
- `apps/web/src/server/routers/sessions-snapshot.ts`
- `apps/web/src/server/routers/sessions-pause.ts`
- Provider implementations:
  - E2B: `pause()` uses `Sandbox.betaPause`, snapshot ID == sandbox ID.
  - Modal: `snapshot()` uses `sandbox.snapshotFilesystem()` (image ID). `pause()` not supported.

### 4) Verify Tool (Evidence Upload)
- Tool stub in `packages/shared/src/opencode-tools/index.ts`
- Gateway intercept: `apps/gateway/src/hub/capabilities/tools/verify.ts`
- Providers must support `readFiles()` to collect evidence from `.proliferate/.verification`.

---

## E2B Provider Details
File: `packages/shared/src/providers/e2b.ts`

### Create / Ensure
- Uses E2B SDK with template alias `E2B_TEMPLATE` (default: `proliferate-base`).
- Supports self-hosted domain via `E2B_DOMAIN`.
- Snapshot restore uses `Sandbox.connect(snapshotId)` and re-injects env vars.
- Fresh create uses `Sandbox.create(template, opts)`.

### Workspace Setup
- Clones repos into `/home/user/workspace/<repo>`.
- Stores metadata in `/home/user/.proliferate/metadata.json`.

### Dependencies + OpenCode
- Writes OpenCode config + tools in parallel.
- Copies preinstalled deps from `/home/user/.opencode-tools` into `.opencode/tool`.
- Starts OpenCode server on port 4096.
- Starts services + Caddy preview proxy asynchronously.

### Pause/Snapshot
- `pause()` uses `Sandbox.betaPause()`.
- `snapshot()` is an alias of `pause()`.

### Read Files (Verify)
- Uses `sandbox.files.list` + `sandbox.files.read` to return `FileContent[]`.

### Image Build
Files:
- `packages/e2b-sandbox/e2b.Dockerfile`
- `packages/e2b-sandbox/template.ts`
- `packages/e2b-sandbox/build.ts`

Key image features:
- OpenCode CLI + MCP servers (`proliferate-sandbox-mcp`, `playwright-mcp`).
- `start-services.sh` starts Docker, Postgres, Redis, Mailcatcher.
- Preinstalled tool deps at `/home/user/.opencode-tools`.

---

## Modal Provider Details
File: `packages/shared/src/providers/modal-libmodal.ts`

### Create / Ensure
- Uses Modal JS SDK directly (libmodal).
- `deploy.py` exposes `get_image_id` so the TS provider can fetch the base image.
- Session ID is used as sandbox name for lookup.
- Snapshot restore uses `client.images.fromId(snapshotId)`.

### Workspace Setup
- Same workspace layout and metadata as E2B.
- Uses `sandbox.exec` and atomic `mkdir + write` to avoid races.

### Dependencies + OpenCode
- Writes OpenCode config + tools in parallel.
- Copies preinstalled deps from `/home/user/.opencode-tools` into `.opencode/tool`.
- Starts OpenCode server on port 4096.
- Starts services + Caddy preview proxy asynchronously.
- If SSH key provided, writes `authorized_keys` and starts `sshd`.

### Snapshot / Pause
- `snapshot()` uses `sandbox.snapshotFilesystem()`; returns image ID.
- `pause()` not supported.

### Read Files (Verify)
- Uses `sandbox.open` + byte read to return `FileContent[]`.

### Image Build
Files:
- `packages/modal-sandbox/Dockerfile`
- `packages/modal-sandbox/deploy.py`

Key image features:
- OpenCode CLI + MCP servers (`proliferate-sandbox-mcp`, `playwright-mcp`).
- `start-dockerd.sh` for Docker-in-sandbox.
- `start-services.sh` for Postgres/Redis/Mailcatcher.
- Preinstalled tool deps at `/home/user/.opencode-tools`.

---

## MCP: sandbox-mcp
File: `packages/sandbox-mcp/src/service-manager.ts`
- Manages services and Caddy exposure from within the sandbox.
- Uses `WORKSPACE_DIR` (or `SANDBOX_WORKSPACE_DIR`) for default cwd.
- Updates `/tmp/Caddyfile` while preserving `/api/*` route.

---

## Environment Variables

### E2B
- `E2B_API_KEY` (required)
- `E2B_DOMAIN` (optional, self-hosted)
- `E2B_TEMPLATE` (optional template alias; default `proliferate-base`)
- `E2B_DEBUG` (optional)

### Modal
- `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` (Modal SDK auth)
- `MODAL_APP_SUFFIX` (optional per-developer app name)

### LLM Proxy
- `LLM_PROXY_URL`, `LLM_PROXY_REQUIRED`
- `LLM_PROXY_API_KEY` (generated per session)

### OpenCode / Anthropic
- `ANTHROPIC_API_KEY` (only when not using proxy)

---

## Parity and Known Differences

### Parity Targets
- Same OpenCode config + MCP servers
- Same tool set + preinstalled deps
- Same workspace layout and metadata
- Same OpenCode and preview ports

### Provider Differences
- **Snapshots**: E2B uses pause/resume; Modal uses filesystem snapshot images.
- **Auto-pause**: E2B supports auto-pause; Modal does not.
- **Sandbox lookup**: Modal uses session name; E2B uses sandbox ID.
- **SDK operations**: E2B uses `sandbox.commands.run`; Modal uses `sandbox.exec`.

---

## Operational Notes
- OpenCode readiness is checked via `/session` in `waitForOpenCodeReady`.
- Services (Postgres/Redis/Mailcatcher) are started asynchronously after sandbox init.
- Caddy is the preview proxy on port 20000.
- The verify tool is intercepted by the Gateway (the sandbox stub does not upload).

---

## Suggested Future Additions
- Document sandbox-mcp API surface and versioning.
- Add a short runbook for diagnosing Caddy/MCP issues.
- Include concrete examples of env var injection flows from UI.
