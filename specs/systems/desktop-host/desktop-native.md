# Desktop Native Shell

Read this before changing `apps/desktop/src-tauri/**`, desktop packaging, native commands, sidecar boot, bundled resources, local secrets, or desktop dispatch worker process management.

The desktop native shell owns the boundary between the React renderer, the OS, bundled binaries, local secrets, and local long-running processes. It does not own product UI structure; use `specs/areas/frontend.md` for renderer code. It does not own AnyHarness runtime internals; use `specs/areas/anyharness.md` for runtime behavior behind the local HTTP API.

## File Tree

```text
apps/desktop/src-tauri/
  tauri.conf.json              # bundle config, externalBin, resources, updater
  Cargo.toml                   # native shell crate and desktop version
  build.rs                     # stages sidecar/helper binaries into binaries/
  agent-seed.inputs.json       # target seed inputs for release builds
  agent-seeds/                 # generated target seed archives and checksums
  binaries/                    # staged target-suffixed external binaries
  src/
    lib.rs                     # Tauri builder, plugins, state, commands, boot
    sidecar.rs                 # AnyHarness sidecar discovery, spawn, health
    diagnostics_collector/    # collector supervision, broker, producer, child bridge, fallback, shutdown
    agent_seed_env.rs          # seed resource/env resolution for sidecar launch
    app_config.rs              # file-backed app config/runtime-info paths
    commands/
      runtime.rs               # renderer commands for AnyHarness runtime status/restart
      cloud_worker.rs          # desktop dispatch worker process lifecycle
      keychain.rs              # local secret storage (auth + env creds as 0600 files; data key in keychain) and sidecar launch secrets
      process.rs               # shell command helpers
      shell.rs                 # OS shell, editor, picker, and open actions
      drag_drop.rs             # drag-pasteboard path recovery for webview drops
      diagnostics.rs           # renderer diagnostics bridge
```

## Specs

| Spec | Use it for |
| --- | --- |
| [AnyHarness Sidecar](#anyharness-sidecar) (this document) | How packaged Desktop bundles, finds, launches, monitors, and restarts the local AnyHarness runtime. |
| [Agent Seeds](#agent-seeds) (this document) | How bundled agent seeds are built, packaged, hydrated, tracked, repaired, and distinguished from downloaded artifacts. |
| `specs/engineering/shipping/desktop-updates.md` and `guides/deploying/releases.md` | Product behavior and release mechanics to read together when changing `tauri.conf.json` updater configuration, updater manifests, or packaged update behavior. |

## Rules

| Area | Rule |
| --- | --- |
| Native shell | Keep OS/Tauri process boundaries in `apps/desktop/src-tauri/**`; keep renderer product UI in `apps/desktop/src/**`. |
| AnyHarness sidecar | `src/sidecar.rs` is the only owner of local AnyHarness process discovery, spawn, health polling, restart, and runtime info persistence. |
| Seed env | `src/agent_seed_env.rs` is the only Tauri-side owner of `ANYHARNESS_AGENT_SEED_*` launch env. Hydration logic stays in AnyHarness. |
| Sidecar binaries | `build.rs` stages binaries; `tauri.conf.json` declares them. Do not add another packaging path for runtime binaries. |
| Diagnostics collector | `src/diagnostics_collector/` is the sole owner of the collector child, launch capability, authenticated client, restart budget, native producer, same-user query broker, and shutdown order. Supported macOS builds start it before owned AnyHarness/Worker starts; observability failure releases product startup in `unsupported` or `degraded` state. |
| Secrets | Recreatable secrets (auth session, pending OAuth, provider env creds) are `0600` files in the durable app home; only the anyharness data key stays in the keychain (see the sidecar spec's Local Secrets). Sidecar launch secrets come from `commands/keychain.rs`; do not persist provider secrets in app config JSON. |
| Desktop dispatch worker | `commands/cloud_worker.rs` and its direct `lifecycle.rs` module own the optional Proliferate Worker launcher process. It is separate from the always-on AnyHarness sidecar. The app exit event stops and reaps the tracked launcher explicitly before Tauri terminates the process. On Windows, updater access also arms shutdown and awaits cleanup after download and before install because install exits without an `Exit` event; later starts become no-ops until that exit. If install fails before exiting, starts remain fail-safe until Desktop is restarted. Process-inspection or termination errors retain the owned child handle and block installation or credential rotation; a persistent inspection error stays blocked for restart or manual recovery rather than risking an unsafe PID-based kill. Releases through 0.3.38 used the `cloud-worker` local namespace; repaired releases use the complete `cloud-worker-v2` config/database/log namespace so a fresh enrollment can revoke and replace an already-orphaned legacy Worker without identifying or killing an unowned process. The renderer enters that namespace only after the enrollment response advertises `pendingTicketPolicy = newest_wins`; until then it retries without reporting the expected deployment skew as a production exception. Credential replacement remains guarded while any untracked Worker owns the active namespace's database lock. |
| Dev profiles | Profile-specific ports, Tauri config, app home, and runtime home come from `guides/local/dev-profiles.md`; do not hard-code default ports into new Tauri flows. |

# Agent Seeds

Agent seeds are packaged desktop resources that preinstall selected managed agent artifacts into the local AnyHarness runtime home. They exist to avoid first-launch network installs for the most important local agents.

## Short Answer

There are not two runtime layouts for seeded vs downloaded agents. Seeded artifacts and downloaded artifacts both end up in the normal AnyHarness runtime home:

```text
<runtime_home>/
  agents/
    claude/
      native/
      agent_process/
    codex/
      native/
      agent_process/
  node/
    <target>/
  agent-seed/
    state.json
```

The difference is ownership metadata in `agent-seed/state.json` and health metadata returned by `/health`, not a different agent resolver path.

## Build Flow

| Step | Code |
| --- | --- |
| Read seed inputs | `apps/desktop/src-tauri/agent-seed.inputs.json` |
| Build temp runtime home | `scripts/build-agent-seed.mjs` |
| Install bundled agents | `anyharness install-agents --reinstall --agent claude --agent codex` |
| Install target Node | Node archive from `agent-seed.inputs.json` |
| Remove generated launchers | `scripts/build-agent-seed.mjs` removes launchers before packaging |
| Write manifest | `manifest.json` inside the seed payload |
| Archive payload | `agent-seed-<target>.tar.zst` |
| Write checksum | `agent-seed-<target>.sha256` |
| Bundle resource | `tauri.conf.json` includes `agent-seeds/` in `bundle.resources` |

Release builds create exactly one target archive plus checksum under:

```text
apps/desktop/src-tauri/agent-seeds/
```

Current v1 seed contents:

- Claude native CLI and ACP agent process
- Codex native CLI and ACP agent process
- target-specific Node runtime

## Tauri Launch Env

`apps/desktop/src-tauri/src/agent_seed_env.rs` decides what seed env to pass to AnyHarness.

| Case | Env passed to sidecar |
| --- | --- |
| Debug/dev with `ANYHARNESS_AGENT_SEED_DIR` | `ANYHARNESS_AGENT_SEED_DIR=<dir>` |
| Packaged app with bundled resource | `ANYHARNESS_AGENT_SEED_DIR=<resource-dir>` and `ANYHARNESS_AGENT_SEED_EXPECTED=1` |
| Packaged app with no bundled resource | `ANYHARNESS_AGENT_SEED_EXPECTED=1` |
| Packaged app with external override | Ignored unless `ANYHARNESS_AGENT_SEED_DIR_UNSAFE=1` is also set |
| Debug/dev with no seed | No seed env; AnyHarness reports `not_configured_dev` |

The resource lookup expects:

```text
agent-seeds/
  agent-seed-<target>.tar.zst
  agent-seed-<target>.sha256
```

On macOS, the fallback resource path is:

```text
<App>.app/Contents/Resources/agent-seeds/
```

## Hydration Flow

1. `anyharness serve` creates an `AgentSeedStore`.
2. If seed health starts as `hydrating`, serve spawns a blocking hydration task.
3. The HTTP runtime starts immediately. `/health` can return while hydration is
   still running.
4. Hydration checks:
   - archive exists
   - checksum matches `.sha256`
   - manifest schema and target are valid
   - archive entries are safe relative paths
   - hydrated executables exist and remain executable
5. Payload extracts into a staging directory under:

```text
<runtime_home>/agent-seed/staging-<uuid>/
```

6. Artifacts are copied into the normal runtime layout.
7. Claude and Codex launchers are regenerated in the final runtime home so their
   absolute paths point at the real local runtime home.
8. macOS quarantine is stripped from hydrated executables on a best-effort basis.
9. `agent-seed/state.json` records the seed version, target, seeded agents,
   per-artifact checksums, and ownership.

## Ownership Rules

| Existing state | Hydration behavior |
| --- | --- |
| Missing artifact, no prior record | Write from seed and mark `seed`. |
| Existing artifact, no prior record | Preserve and mark `user_existing`. |
| Prior `seed`, file missing | Restore from seed and count as repaired. |
| Prior `seed`, file unchanged, new seed version | Replace with new seed. |
| Prior `seed`, file changed | Preserve and mark `user_modified`. |
| Prior `user_existing` or `user_modified` | Preserve. |

Managed install and reconcile paths refresh seed state after installs. If a seed-owned artifact is replaced by an install path, it becomes user-modified so future seeds do not silently overwrite it.

## Health States

`/health` includes `agentSeed`.

| Status | Meaning |
| --- | --- |
| `not_configured_dev` | Dev runtime started without seed env. |
| `missing_bundled_seed` | Packaged runtime expected a seed but could not find the target archive/checksum. |
| `hydrating` | Archive validation/extraction is running in the background. |
| `ready` | All manifest artifacts are seed-owned. |
| `partial` | Some or all artifacts were preserved as user-owned existing/modified files. |
| `failed` | Checksum, manifest, archive, verification, target, or IO failure. |

Ownership can be:

- `full_seed`
- `partial_seed`
- `user_owned_existing`
- `not_configured`

## Reconcile Interaction

Desktop should not start reconcile while seed status is `hydrating`. After hydration, reconcile can install non-seeded or still-missing agents.

For dev runtimes with `not_configured_dev`, reconcile should remain a manual setup action. Local dev without a seed must not silently kick off long network installs at app boot.

## Paths To Know

| Path | Meaning |
| --- | --- |
| `apps/desktop/src-tauri/agent-seed.inputs.json` | Source of release seed inputs. |
| `apps/desktop/src-tauri/agent-seeds/agent-seed-<target>.tar.zst` | Generated Tauri resource archive. |
| `<runtime_home>/agents/<kind>/native/` | Managed native CLI artifact path. |
| `<runtime_home>/agents/<kind>/agent_process/` | Managed ACP/agent-process artifact path. |
| `<runtime_home>/node/<target>/` | Bundled Node runtime hydrated from seed. |
| `<runtime_home>/agent-seed/state.json` | Ownership and repair state. |

# AnyHarness Sidecar

This spec covers the local AnyHarness runtime process launched by the Desktop native shell. It is the process that serves the local HTTP API used by the desktop renderer.

## Ownership

| Code | Owns |
| --- | --- |
| `apps/desktop/src-tauri/tauri.conf.json` | Declares `binaries/anyharness`, `binaries/proliferate-worker`, `binaries/proliferate-debug`, and `binaries/proliferate-diagnostics-collector` as Tauri `externalBin` entries. |
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

For the two accepted macOS targets, release staging requires the exact prebuilt `proliferate-diagnostics-collector` artifact and fails rather than substituting a placeholder. Debug builds may stage a marked placeholder so unrelated Desktop work can compile; the supervisor classifies it as `binary_invalid`. Other targets retain an explicit unsupported placeholder and the native health state is `unsupported`, never ready.

The Proliferate Worker binary follows the same staging/bundling model, but it is not the AnyHarness sidecar. It is launched on demand by desktop dispatch logic in `commands/cloud_worker.rs`.

Desktop worker config must set `runtime_base_url` from the current `SharedSidecar.info.url`. The sidecar normally uses a dynamically selected loopback port (and may use `ANYHARNESS_DEV_URL` in development), so the worker must not rely on its sandbox-oriented `127.0.0.1:8457` default when connecting to the local runtime for catalog convergence or command delivery.

## Boot Flow

1. `lib.rs` calls `sidecar::create_sidecar_with_auto_port()`.
2. Port selection uses `ANYHARNESS_PORT` when set, otherwise an available
   loopback port.
3. During Tauri `setup`, the app starts the owner-only diagnostics broker and
   waits for the collector's authenticated, schema-compatible startup barrier.
   A bounded failure resolves the same barrier as degraded so product startup
   cannot be held indefinitely.
4. The app builds sidecar launch env from:
   - local secrets (see [Local Secrets](#local-secrets))
   - agent seed env from `agent_seed_env::launch_env`
5. `sidecar::boot` starts one of two modes:
   - external runtime mode when `ANYHARNESS_DEV_URL` is set
   - managed child process mode otherwise
6. Managed child process mode finds the binary in this order:
   - `ANYHARNESS_BIN`
   - packaged `anyharness-<target>` next to current executable
   - packaged/dev plain `anyharness` next to current executable
   - workspace target/debug or target/release candidates
   - common install path fallback
7. The command is:

```text
anyharness serve --host 127.0.0.1 --port <port>
```

8. Launch env also includes:
   - the user's login-shell `PATH`
   - hosted-product Sentry env when applicable
9. The native shell polls `<runtime-url>/health` until healthy, failed, exited,
   or timed out.
10. `runtime-info.json` is written under the desktop app dir with URL, port,
   status, runtime home, and runtime version.
11. On a healthy response, `runtime_version_assert::check` compares the health
   record's `version` against the version baked into the shell from
   `apps/desktop/runtime-version.json` (`include_str!` at compile time — not a
   runtime resource read). Release CI (`release-desktop.yml`) writes that file
   from the `anyharness` crate's `Cargo.toml` version right before `pnpm tauri
   build` compiles the shell, so the baked value matches whichever sidecar
   binary actually shipped alongside it. Mode is
   `PROLIFERATE_RUNTIME_VERSION_ASSERT` (`off` / `warn` / `block`, default
   `warn`); `block` reuses the same `BootOutcome::Failed` unhealthy path as any
   other boot failure. Every read on this boundary is tolerant — a
   missing/garbage bundled file or a health record missing `version` only
   warns, never blocks — and the `ANYHARNESS_DEV_URL` external-runtime bypass
   always stays warn-only regardless of the configured mode. Caveat: the
   `anyharness` crate version is a never-bumped `0.1.0` today, so
   `expected == actual` trivially passes on every current build; the assert's
   present value is catching a corrupted or mismatched bundle, not today's
   version drift. A version-bump scheme is a release-pipeline decision left as
   a follow-up.

## Runtime Home

The sidecar chooses its runtime home inside AnyHarness unless a dev profile passes `--runtime-home`. In normal packaged desktop usage the default local home is under:

```text
~/.proliferate/anyharness/
```

Dev profiles use:

```text
~/.proliferate-local/runtimes/<profile>/
```

The renderer should treat `get_runtime_info` and `/health` as the source of truth for the current sidecar URL and runtime home.

## Local Secrets

`commands/keychain.rs` resolves the secrets folded into sidecar launch env. Two storage backends, split by sensitivity:

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

A one-time, best-effort purge clears secrets an older build left in the keychain. The desktop release matrix is macOS-only and the files are owner-only (`0600`) on unix; Windows/Linux desktop builds, if added, should revisit storage (Windows has no `0600` path, and both have user-scoped OS keychains that survive reinstall).

## Restart Rules

`restart_runtime` must restart with the same classes of launch env as first boot:

- local secrets (see [Local Secrets](#local-secrets))
- bundled/external agent seed env
- sidecar-owned default env
- shell `PATH`

Do not restart AnyHarness from renderer code by shelling out directly. Use the Tauri command so state, child process ownership, and `runtime-info.json` remain consistent.

## Diagnostics Collector And Shutdown

Tauri passes a new 32-byte random capability and a typed control channel to each collector launch through child-only inherited descriptors. It reads one bounded descriptor line, authenticates health, and exposes no endpoint or token to renderer code or the CLI. The CLI resolves an owner-only locator and uses the Tauri-owned pathname Unix-socket broker; customer artifacts reject external export, while the default-off internal artifact permits only the accepted internal point-in-time export.

Native `tracing` detail uses a 1 MiB/256-record memory queue. Before readiness, during outages, and after collector teardown, `desktop-native.log` is the structurally scrubbed fallback: active plus `.1` through `.3`, 256 KiB each, with no disk replay. Exact schema-v1.1 Desktop renderer batches normally enter the ready collector through the main-window-only native command. After native validation and before any authenticated request, `starting`, `unsupported`, `degraded`, `stopped`, and shutdown-armed states may write each already-filtered renderer record through the same bounded fallback pipeline without activating it; the command still returns its original unavailable error. Post-dispatch receipt, replacement, deadline, and transport failures do not fall back. The obsolete renderer diagnostics file receives no new writes, while historical support discovery remains. Sentry, PostHog, anonymous telemetry, and support composition remain under their existing owners.

On the two supported packaged macOS targets, owned AnyHarness and Worker launches prepare the direct executable first, then create the fallback-root, bridge, and shutdown descriptors; only a direct binary child may inherit them (never Cargo, a shell, or any wrapper — a `cargo run` launcher spawns unprotected). A pre-exec descriptor failure closes every partial authority and performs at most one direct unprotected relaunch — an observability outcome, never a product failure — and a returned successful protected spawn is the point of no retry. Each bridge lives on the identity-stable process owner (`SidecarProcess`, `CloudWorkerProcess`) beside the owned `Child`; the Worker owner also holds the two pipe drainers and the bounded 65,536-byte/12-line in-memory tail that replaces `worker.log` on supported targets. Historical `worker.log` files are untouched customer data, and unsupported builds keep the legacy writer verbatim. Parent status and flush are one-slot requests with fixed deadlines; the child's terminal status/fence is cached at most once, and the tail is cleared only when the verified owner is released. Each owner starts one generation-bound natural-exit observer after healthy startup; explicit stop/restart cancels it while holding the same lifecycle mutex, and an ambiguous inspection retains the full owner for later reconciliation.

Terminal shutdown is idempotent: arm shutdown and cancel broker leases; drain the native queue while one absolute 500 ms deadline concurrently covers that drain plus both child bridge shutdown-signal/flush requests, each capped at the milliseconds remaining. Child HTTP dispatch and remaining fallback writes consume that same absolute window, and a later natural guard reuses a parent flush result instead of starting another wait. Then stop/reap Worker and AnyHarness while the collector remains available; admit the collector-stop start; stop/reap the collector; write its terminal to teardown fallback; remove the locator; close fallback. Windows' direct-exit updater command enters this same coordinator before installation, preserving its existing fail-closed Worker behavior.

## Desktop Path Inspection

`commands/shell.rs::inspect_path` is the native metadata boundary for a path that product code has already routed to Desktop. It accepts only a non-empty, NUL-free, platform-absolute path and intentionally uses `std::fs::metadata` so the final link is followed. Its serialized response is path-free:

- regular file/link-to-file: `{"kind":"file"}`
- directory/link-to-directory: `{"kind":"directory"}`
- missing, `NotADirectory`, or dangling link: `{"kind":"missing"}`
- invalid input, denied metadata, unsupported object type, or other I/O:
  `{"kind":"unavailable","reason":"<bounded_reason>"}`

The bounded reasons are `invalid_path`, `permission_denied`, `unsupported_type`, and `io_error`. Expected outcomes do not use a native string-error channel, and the command does not log the input, link target, or OS error. Inspection and the later OS open are separate operations; the same-user race between them is accepted.

## Failure Modes

| Failure | Handling |
| --- | --- |
| Binary cannot be found | Runtime status becomes `failed`; no child is stored. |
| Placeholder binary launched | Child exits before healthy; status becomes `failed`. |
| Child exits before `/health` | Status becomes `failed`. |
| `/health` times out | Status becomes `failed` after the startup timeout. |
| External `ANYHARNESS_DEV_URL` never becomes healthy | Status becomes `failed`; no child process is killed because Desktop does not own it. |
