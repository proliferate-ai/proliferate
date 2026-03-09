# Providers Specification (Current)

Implementation-level spec for `packages/shared/src/providers`.

This document is intentionally code-first and describes current runtime behavior in:

- `packages/shared/src/providers/index.ts`
- `packages/shared/src/providers/modal-libmodal.ts`
- `packages/shared/src/providers/e2b.ts`
- `packages/shared/src/sandbox-provider.ts`
- `packages/shared/src/sandbox/config.ts`

## 1) Purpose

Providers abstract sandbox compute backends behind one contract (`SandboxProvider`).  
Session orchestration is owned by gateway/runtime; providers only handle compute lifecycle mechanics:

- create/recover sandbox
- snapshot/pause/terminate
- tunnel resolution
- sandbox command/file operations
- bootstrapping OpenCode + sidecars inside sandbox

## 2) Factory and Selection

Provider factory (`index.ts`):

- `getSandboxProvider(type?)`
	- uses explicit `type` if given
	- otherwise uses `DEFAULT_SANDBOX_PROVIDER`
	- throws on unknown/missing provider type
- `getSandboxProviderForSnapshot(provider)` delegates to `getSandboxProvider`

Supported provider types:

- `modal`
- `e2b`

## 3) Contract Surface

Contract lives in `sandbox-provider.ts`.

Required methods:

- `ensureSandbox(opts)`
- `createSandbox(opts)`
- `snapshot(sessionId, sandboxId)`
- `pause(sessionId, sandboxId)`
- `terminate(sessionId, sandboxId?)`
- `writeEnvFile(sandboxId, envVars)`
- `health()`

Optional methods:

- `checkSandboxes(sandboxIds)`
- `resolveTunnels(sandboxId)`
- `readFiles(sandboxId, folderPath)`
- `testServiceCommands(sandboxId, commands, opts)`
- `execCommand(sandboxId, argv, opts)`
- `memorySnapshot(sessionId, sandboxId)`
- `restoreFromMemorySnapshot(sessionId, snapshotId, opts)`

Capability flags are authoritative:

- `supportsPause`
- `supportsAutoPause`
- `supportsMemorySnapshot`

## 4) Capability Matrix

### Modal (`ModalLibmodalProvider`)

- `supportsPause = false`
- `supportsAutoPause = false`
- `supportsMemorySnapshot = true`
- Supports memory snapshots via Modal control plane:
	- create: `memorySnapshot(...)` -> returns `mem:<snapshotId>`
	- restore: `restoreFromMemorySnapshot(...)`

### E2B (`E2BProvider`)

- `supportsPause = true`
- `supportsAutoPause = true`
- no memory snapshot support
- Pause semantics:
	- `pause(...)` uses `Sandbox.betaPause`
	- returns `snapshotId = sandboxId` (resume-by-connect model)

## 5) Ensure vs Create Semantics

### `ensureSandbox(opts)`

`ensureSandbox` is the normal runtime entry point.

- Modal:
	- if `snapshotId` starts with `mem:`, uses memory restore path immediately
	- otherwise tries to recover existing sandbox by session name
	- if name lookup fails, falls back to `currentSandboxId` probe
	- if recovery fails, creates new sandbox
- E2B:
	- checks `currentSandboxId` with side-effect-free info API
	- if alive, resolves tunnels and returns recovered
	- otherwise creates new sandbox

### `createSandbox(opts)`

Creates a new sandbox (or snapshot restore for explicit snapshot inputs).

- Modal image source precedence:
	1. restore snapshot (`opts.snapshotId`)
	2. base snapshot (`opts.baseSnapshotId` or `MODAL_BASE_SNAPSHOT_ID`)
	3. base image from `get_image_id`
- E2B restore/create behavior:
	- if snapshot and `currentSandboxId`: connect to paused sandbox
	- else if snapshot only: create from snapshot template
	- on snapshot resume failure: falls back to fresh create

## 6) Boot Model (Both Providers)

Both providers use two-phase boot:

### Essential (blocking)

- determine workspace/repoDir (clone or restore)
- write OpenCode config + plugin + tools + instructions
- ensure preinstalled tool deps copied
- start OpenCode server

### Additional (async / fire-and-forget)

- start services stack helpers
- start Caddy preview proxy
- start sandbox-mcp
- optionally run git freshness pull on restore
- apply secret file writes
- optionally start configured service commands

This split keeps session readiness fast while preserving ergonomics.

## 7) In-Sandbox Assets and Paths

Shared constants come from `sandbox/config.ts`.

Notable paths:

- workspace root: `/home/user/workspace`
- OpenCode global config: `/home/user/.config/opencode/opencode.json`
- plugin: `/home/user/.config/opencode/plugin/proliferate.mjs`
- metadata: `/home/user/.proliferate/metadata.json`
- per-session env profile: `/home/user/.env.proliferate`
- preinstalled tool deps: `/home/user/.opencode-tools`
- Caddy config: `/home/user/Caddyfile`

Default ports:

- OpenCode: `4096`
- Preview/Caddy: `20000`
- SSH: `22`
- VS Code: `3901`

## 8) Tool Injection Rules

Core tools are always injected:

- `verify`
- `save_snapshot`
- `automation_complete`

Setup-only tools are session-type gated:

- `save_service_commands`

For non-setup sessions, providers actively remove setup-only tools during restore to avoid leakage from setup snapshots.

## 9) Snapshot and Pause Semantics

### Filesystem snapshot

- Modal: `sandbox.snapshotFilesystem()`
- E2B: `Sandbox.createSnapshot(sandboxId, ...)`

### Pause

- Modal: unsupported and throws explicit provider error
- E2B: pauses sandbox and returns sandbox ID as resume handle

### Memory snapshot (Modal only)

- snapshot IDs are wrapped as `mem:<id>`
- restore waits for OpenCode readiness before returning

## 10) Recovery and Freshness

Both providers implement snapshot-restore freshness behavior:

- cadence-gated by `shouldPullOnRestore(...)`
- refreshes `/tmp/.git-credentials.json` with current repo tokens on restore
- runs `git pull --ff-only` per repo when allowed
- only advances `lastGitFetchAt` in metadata if all pulls succeed
- pull failures are non-fatal

## 11) Sidecars and Processes

### Both

- OpenCode server
- Caddy preview proxy
- sandbox-mcp API

### E2B only (currently)

- starts `sandbox-daemon` (`sandbox-daemon --mode=worker`)

## 12) Command/File Utilities

- `execCommand(...)`
	- Modal: true argv execution via SDK exec
	- E2B: SDK is shell-string based, provider safely shell-escapes argv
- `testServiceCommands(...)` is supported by both
- `readFiles(...)` is supported by both for verification uploads
- `writeEnvFile(...)` merges with existing JSON env file

## 13) Health and Liveness Checks

- Modal health: auth preflight + sandbox list call
- E2B health: requires `E2B_API_KEY`, then `Sandbox.list(...)`

`checkSandboxes(...)` is side-effect-free in both providers:

- Modal: compares requested IDs against `sandboxes.list()`
- E2B: compares against `Sandbox.list(...)` paginator (does not connect/resume)

## 14) Error and Safety Behavior

- Provider methods wrap failures with `SandboxProviderError` where applicable
- Terminate is idempotent-ish:
	- not-found cases are treated as success paths
- Additional boot failures are logged and non-fatal
- OpenCode readiness failures are generally warnings (except Modal memory-restore readiness gate, which is strict)

## 15) Current Limitations

- E2B provider does not currently write SSH authorized keys in essential boot (Modal does).
- E2B provider does not currently write trigger-context file during essential boot (Modal does).
- Tool-call idempotency and some lifecycle guards live upstream (gateway), not in providers.
- `execCommand` parity differs by SDK constraints (argv-native on Modal vs escaped shell command on E2B).

