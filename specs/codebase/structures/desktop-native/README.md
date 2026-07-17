# Desktop Native Shell

Read this before changing `apps/desktop/src-tauri/**`, desktop packaging,
native commands, sidecar boot, bundled resources, local secrets, or desktop
dispatch worker process management.

The desktop native shell owns the boundary between the React renderer, the OS,
bundled binaries, local secrets, and local long-running processes. It does not
own product UI structure; use `specs/codebase/structures/frontend/README.md` for renderer code.
It does not own AnyHarness runtime internals; use `specs/codebase/structures/anyharness/README.md`
for runtime behavior behind the local HTTP API.

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
    agent_seed_env.rs          # seed resource/env resolution for sidecar launch
    app_config.rs              # file-backed app config/runtime-info paths
    commands/
      runtime.rs               # renderer commands for AnyHarness runtime status/restart
      cloud_worker.rs          # desktop dispatch worker process lifecycle
      keychain.rs              # local secret storage (auth + env creds as 0600 files; data key in keychain) and sidecar launch secrets
      process.rs               # shell command helpers
      shell.rs                 # OS shell, editor, picker, and open actions
      diagnostics.rs           # renderer diagnostics bridge
```

## Specs

| Spec | Use it for |
| --- | --- |
| `specs/codebase/structures/desktop-native/specs/anyharness-sidecar.md` | How packaged Desktop bundles, finds, launches, monitors, and restarts the local AnyHarness runtime. |
| `specs/codebase/structures/desktop-native/specs/agent-seeds.md` | How bundled agent seeds are built, packaged, hydrated, tracked, repaired, and distinguished from downloaded artifacts. |
| `specs/codebase/systems/engineering/delivery/desktop-updates.md` and `specs/developing/deploying/releases.md` | Product behavior and release mechanics to read together when changing `tauri.conf.json` updater configuration, updater manifests, or packaged update behavior. |

## Rules

| Area | Rule |
| --- | --- |
| Native shell | Keep OS/Tauri process boundaries in `apps/desktop/src-tauri/**`; keep renderer product UI in `apps/desktop/src/**`. |
| AnyHarness sidecar | `src/sidecar.rs` is the only owner of local AnyHarness process discovery, spawn, health polling, restart, and runtime info persistence. |
| Seed env | `src/agent_seed_env.rs` is the only Tauri-side owner of `ANYHARNESS_AGENT_SEED_*` launch env. Hydration logic stays in AnyHarness. |
| Sidecar binaries | `build.rs` stages binaries; `tauri.conf.json` declares them. Do not add another packaging path for runtime binaries. |
| Secrets | Recreatable secrets (auth session, pending OAuth, provider env creds) are `0600` files in the durable app home; only the anyharness data key stays in the keychain (see the sidecar spec's Local Secrets). Sidecar launch secrets come from `commands/keychain.rs`; do not persist provider secrets in app config JSON. |
| Desktop dispatch worker | `commands/cloud_worker.rs` and its direct `lifecycle.rs` module own the optional Proliferate Worker launcher process. It is separate from the always-on AnyHarness sidecar. The app exit event stops and reaps the tracked launcher explicitly before Tauri terminates the process. On Windows, updater access also arms shutdown and awaits cleanup after download and before install because install exits without an `Exit` event; later starts become no-ops until that exit. If install fails before exiting, starts remain fail-safe until Desktop is restarted. Process-inspection or termination errors retain the owned child handle and block installation or credential rotation; a persistent inspection error stays blocked for restart or manual recovery rather than risking an unsafe PID-based kill. Releases through 0.3.38 used the `cloud-worker` local namespace; repaired releases use the complete `cloud-worker-v2` config/database/log namespace so a fresh enrollment can revoke and replace an already-orphaned legacy Worker without identifying or killing an unowned process. The renderer enters that namespace only after the enrollment response advertises `pendingTicketPolicy = newest_wins`; until then it retries without reporting the expected deployment skew as a production exception. Credential replacement remains guarded while any untracked Worker owns the active namespace's database lock. |
| Dev profiles | Profile-specific ports, Tauri config, app home, and runtime home come from `specs/developing/local/dev-profiles.md`; do not hard-code default ports into new Tauri flows. |
