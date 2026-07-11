# AnyHarness Sidecar

This spec covers the local AnyHarness runtime process launched by the Desktop
native shell. It is the process that serves the local HTTP API used by the
desktop renderer.

## Ownership

| Code | Owns |
| --- | --- |
| `apps/desktop/src-tauri/tauri.conf.json` | Declares `binaries/anyharness`, `binaries/proliferate-worker`, and `binaries/proliferate-debug` as Tauri `externalBin` entries. |
| `apps/desktop/src-tauri/build.rs` | Stages target-suffixed binaries into `apps/desktop/src-tauri/binaries/` before Tauri packaging. |
| `apps/desktop/src-tauri/src/lib.rs` | Creates shared native state, registers commands, collects launch env, and starts boot during `setup`. |
| `apps/desktop/src-tauri/src/sidecar.rs` | Finds the AnyHarness binary, spawns it, polls `/health`, persists runtime info, and restarts it. |
| `apps/desktop/src-tauri/src/commands/runtime.rs` | Exposes renderer commands for runtime status and restart. |
| `anyharness/crates/anyharness/src/commands/serve.rs` | Starts the HTTP runtime once the sidecar process is spawned. |

## Build And Bundle Flow

1. `tauri.conf.json` lists `binaries/anyharness` in `bundle.externalBin`.
2. `build.rs` stages a target-specific file such as
   `binaries/anyharness-aarch64-apple-darwin`.
3. Staging resolution order is:
   - explicit `ANYHARNESS_BIN`
   - built or existing workspace `target/<target>/<profile>/anyharness`
   - built or existing workspace `target/<profile>/anyharness`
   - common install paths such as `~/.cargo/bin/anyharness`
4. Unsupported targets get executable placeholders so packaging remains explicit
   and fails clearly if launched.
5. Packaged Tauri apps place external binaries next to the app executable. On
   macOS this means the sidecar binary is resolved from the app bundle's
   `Contents/MacOS` directory.

The Proliferate Worker binary follows the same staging/bundling model, but it
is not the AnyHarness sidecar. It is launched on demand by desktop dispatch
logic in `commands/cloud_worker.rs`.

Desktop worker config must set `runtime_base_url` from the current
`SharedSidecar.info.url`. The sidecar normally uses a dynamically selected
loopback port (and may use `ANYHARNESS_DEV_URL` in development), so the worker
must not rely on its sandbox-oriented `127.0.0.1:8457` default when connecting
to the local runtime for catalog convergence or command delivery.

## Boot Flow

1. `lib.rs` calls `sidecar::create_sidecar_with_auto_port()`.
2. Port selection uses `ANYHARNESS_PORT` when set, otherwise an available
   loopback port.
3. During Tauri `setup`, the app builds sidecar launch env from:
   - local secrets (see [Local Secrets](#local-secrets))
   - agent seed env from `agent_seed_env::launch_env`
4. `sidecar::boot` starts one of two modes:
   - external runtime mode when `ANYHARNESS_DEV_URL` is set
   - managed child process mode otherwise
5. Managed child process mode finds the binary in this order:
   - `ANYHARNESS_BIN`
   - packaged `anyharness-<target>` next to current executable
   - packaged/dev plain `anyharness` next to current executable
   - workspace target/debug or target/release candidates
   - common install path fallback
6. The command is:

```text
anyharness serve --host 127.0.0.1 --port <port>
```

7. Launch env also includes:
   - `ANYHARNESS_DEFER_STARTUP_RETENTION=1`
   - the user's login-shell `PATH`
   - hosted-product Sentry env when applicable
8. The native shell polls `<runtime-url>/health` until healthy, failed, exited,
   or timed out.
9. `runtime-info.json` is written under the desktop app dir with URL, port,
   status, runtime home, and runtime version.

## Runtime Home

The sidecar chooses its runtime home inside AnyHarness unless a dev profile
passes `--runtime-home`. In normal packaged desktop usage the default local home
is under:

```text
~/.proliferate/anyharness/
```

Dev profiles use:

```text
~/.proliferate-local/runtimes/<profile>/
```

The renderer should treat `get_runtime_info` and `/health` as the source of
truth for the current sidecar URL and runtime home.

## Local Secrets

`commands/keychain.rs` resolves the secrets folded into sidecar launch env. Two
storage backends, split by sensitivity:

- **Recreatable secrets** — the desktop **auth session** + **pending OAuth state**
  + **provider/env credentials** — are stored as **`0600` files under the durable
  app home** (`~/.proliferate`, dev `~/.proliferate-local`): `auth-session.json`,
  `pending-auth.json`, and an `env-secrets.json` `{name: value}` map. The app home
  survives uninstall/reinstall and updates, so these persist across them. They are
  deliberately **not** in the macOS keychain: a keychain item's ACL is bound to
  the build's code signature, so a reinstalled/re-signed build can no longer read
  it (the former "log in again after reinstall" bug).
- **The anyharness data key** (`ANYHARNESS_DATA_KEY`) — an at-rest **encryption
  key** that a plaintext file would defeat — stays in the **macOS keychain**
  (`com.proliferate.app.runtime`). Generated on first use, injected into the
  sidecar env.

A one-time, best-effort purge clears secrets an older build left in the keychain.
The desktop release matrix is macOS-only and the files are owner-only (`0600`) on
unix; Windows/Linux desktop builds, if added, should revisit storage (Windows has
no `0600` path, and both have user-scoped OS keychains that survive reinstall).

## Restart Rules

`restart_runtime` must restart with the same classes of launch env as first
boot:

- local secrets (see [Local Secrets](#local-secrets))
- bundled/external agent seed env
- sidecar-owned default env
- shell `PATH`

Do not restart AnyHarness from renderer code by shelling out directly. Use the
Tauri command so state, child process ownership, and `runtime-info.json` remain
consistent.

## Failure Modes

| Failure | Handling |
| --- | --- |
| Binary cannot be found | Runtime status becomes `failed`; no child is stored. |
| Placeholder binary launched | Child exits before healthy; status becomes `failed`. |
| Child exits before `/health` | Status becomes `failed`. |
| `/health` times out | Status becomes `failed` after the startup timeout. |
| External `ANYHARNESS_DEV_URL` never becomes healthy | Status becomes `failed`; no child process is killed because Desktop does not own it. |
