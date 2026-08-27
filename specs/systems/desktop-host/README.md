# Desktop Host (seam)

Status: current (grade B). System spec in the Organization Standard anatomy. The seam between the compiled product (one React bundle mounted by Desktop and Web through `ProductHost`), the native Tauri shell, and the two local processes the shell owns: the **AnyHarness sidecar** and the **desktop worker**. It is a seam spec, not a system: it owns a contract between planes (which bundle calls which native command, which process gets which env), and the small amount of state that contract needs. Everything the shell hosts *for* another system is fenced to that system.

Depth references: [DESKTOP_HOST.md](deep-dive.md) (the `ProductHost` / `DesktopBridge` contract), [desktop-native.md](desktop-native.md) (build, bundle, sidecar boot, secrets, diagnostics), [worker.md](../../areas/anyharness.md).

## 1. Purpose

Make Desktop a thin native shell: the same product code runs on Web with `desktop: null`, and every Desktop-only behavior is a capability behind the optional `DesktopBridge`. The shell's jobs are to boot and supervise the local runtime, enroll and supervise the desktop worker under the signed-in (user, org) identity, keep local secrets, and expose native OS affordances — nothing product-shaped.

## 2. Owned state

| State | Where |
| --- | --- |
| `runtime-info.json` — sidecar URL, port, status, runtime home, version | [sidecar.rs](../../../apps/desktop/src-tauri/src/sidecar.rs) via `app_config::write_runtime_info_record` |
| Sidecar process + exit observer + diagnostics bridge | `SidecarState` in [sidecar.rs](../../../apps/desktop/src-tauri/src/sidecar.rs), [sidecar/lifecycle.rs](../../../apps/desktop/src-tauri/src/sidecar/lifecycle.rs), [observer.rs](../../../apps/desktop/src-tauri/src/sidecar/observer.rs), [state.rs](../../../apps/desktop/src-tauri/src/sidecar/state.rs) |
| Desktop worker process, credential lock (`cloud-worker-v2` namespace), bounded log tail | [commands/cloud_worker.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker.rs) + [state.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/state.rs), [lifecycle.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/lifecycle.rs), [spawn.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/spawn.rs), [tail.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/tail.rs) |
| Local secrets: `auth-session.json`, `pending-auth.json`, `env-secrets.json` (0600 under the app home) and the `ANYHARNESS_DATA_KEY` keychain item | [commands/keychain.rs](../../../apps/desktop/src-tauri/src/commands/keychain.rs) |
| App config, desktop install id, telemetry mode | [app_config.rs](../../../apps/desktop/src-tauri/src/app_config.rs), [commands/desktop_identity.rs](../../../apps/desktop/src-tauri/src/commands/desktop_identity.rs), [desktop_telemetry_mode.rs](../../../apps/desktop/src-tauri/src/desktop_telemetry_mode.rs) |
| The enrolled `(user, org)` identity key (process-wide, renderer side) | [use-desktop-worker-enrollment.ts](../../../apps/packages/product-client/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts) |

## 3. Public surface

**Renderer → shell**: the Tauri command list registered in [lib.rs](../../../apps/desktop/src-tauri/src/lib.rs). Seam-owned commands: `get_runtime_info`, `restart_runtime` ([commands/runtime.rs](../../../apps/desktop/src-tauri/src/commands/runtime.rs)); `ensure_desktop_dispatch_worker`, `prepare_desktop_dispatch_worker_update`, `stop_desktop_dispatch_worker`; `get_app_config`/`set_app_config`; `get_desktop_install_id`; the keychain get/set/clear pairs; `set_running_agent_count` (quit flow); shell affordances (`pick_folder`, `open_in_editor`, `reveal_in_finder`, `open_in_terminal`, `open_external`, `copy_text`, `inspect_path`, `list_available_editors`, `command_exists`); window chrome; drag-drop; workspace scratch pad; workspace activity indicator.

**Product-side contract**: `ProductHost` and `DesktopBridge` in [product-host.ts](../../../apps/packages/product-client/src/host/product-host.ts) and [desktop-bridge.ts](../../../apps/packages/product-client/src/host/desktop-bridge.ts); `host.desktop !== null` is the capability check, never `surface === "desktop"`.

**Shell → sidecar**: `anyharness serve --host 127.0.0.1 --port <port>` with launch env = local secrets + agent seed env ([agent_seed_env.rs](../../../apps/desktop/src-tauri/src/agent_seed_env.rs)) + login-shell `PATH` + `PROLIFERATE_API_BASE_URL_ORIGIN`; health polled at `/health` (250 ms, 60 s timeout).

**Shell → worker**: `proliferate-worker` spawned with a config whose `runtime_base_url` is the *current* sidecar URL and a single-use enrollment ticket handed in by the renderer.

## 4. Consumes

- The **sessions/workspaces/harnesses** HTTP surfaces through the sidecar URL
  (the product talks to AnyHarness directly; the shell only hands over the URL).
- The **seam** (control plane ↔ worker): the enrollment ticket the renderer
  obtains from the control plane and the worker's enroll/heartbeat client
  ([worker cloud_client](../../../anyharness/crates/proliferate-worker/src/cloud_client/mod.rs)).
- **diagnostics** (plane-infra): the collector supervisor, child bridge and
  support snapshot under `src-tauri/src/diagnostics*` — the shell *hosts* them.
- **release-delivery**: owned updater ([updater_owned.rs](../../../apps/desktop/src-tauri/src/updater_owned.rs))
  and [runtime_version_assert.rs](../../../apps/desktop/src-tauri/src/runtime_version_assert.rs).

## 5. Laws

**One host contract, capability-checked.** Product code checks `host.desktop`, never the surface string; a Desktop-only lifecycle lives behind the bridge or it does not exist ([DESKTOP_HOST.md](deep-dive.md)).

**Restart rebuilds the same env classes as boot.** `restart_runtime` re-collects local secrets, seed env, sidecar defaults and shell `PATH`; renderer code never shells out to restart AnyHarness ([desktop-native.md](desktop-native.md), Restart Rules).

**The worker follows the sidecar, not the sandbox default.** Desktop worker config sets `runtime_base_url` from `SharedSidecar.info.url` — the sidecar port is dynamic, so the worker's `127.0.0.1:8457` sandbox default is never valid here.

**Enrollment is keyed by (user, org) and rotates identity.** The renderer guard enrolls once per `${userId}::${orgId}`; a user or org change re-enrolls (server-side ticket consumption rotates worker + integration-gateway identity), sign-out tears the worker down and deletes the gateway dotfile, and a failed enrollment clears the guard and retries after 15 s while mounted ([use-desktop-worker-enrollment.ts](../../../apps/packages/product-client/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts)). This is what makes the desktop the identity-bearing target for integration access (Law 5 at the edge).

**Worker credentials are locked while it runs.** Replacing worker credentials while a worker process holds the `cloud-worker-v2` lock is refused (`WORKER_CREDENTIALS_LOCKED_ERROR`), and a legacy `cloud-worker` lock is never inspected or killed.

**Desktop never self-updates its runtime.** `self_update_enabled=false` is hardcoded and no runtime-swap gate or bridge field is written ([commands/cloud_worker.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker.rs)); binary convergence on desktop is the app update, owned by release-delivery.

**A missing native transport is silent, never a toast.** A worker failure raised while `worker.isSupported()` is false (web build, intent tests) is an expected environment shape and shows nothing.

**Recreatable secrets live in 0600 files, the data key in the keychain.** A keychain ACL is bound to the code signature, so a reinstalled build could not read a keychain-held session; only the at-rest encryption key belongs there.

## 6. Emits

- `RuntimeInfo { url, port, status: starting|healthy|failed|stopped }` to the
  renderer and `runtime-info.json` on disk.
- Desktop worker startup failure notices (`desktopWorkerStartupFailureNotice`)
  rendered as one retryable toast per distinct failure.
- Shortcut events, drag-drop pasteboard changes, workspace activity indicator
  state (native chrome signals).

## 7. Fences

| Not owned | Owner |
| --- | --- |
| Worker enrollment protocol, heartbeat, identity store, gateway credential file | seam (worker crate; today [worker.md](../../areas/anyharness.md)) |
| Supervisor, mailbox, binary swaps, cloud convergence | managed_runtime ([MANAGED_RUNTIME.md](../harnesses/managed-runtime.md)) |
| Diagnostics collector, child bridge, support snapshot, scrubbing (`src-tauri/src/diagnostics*`) | diagnostics plane-infra (frozen, ADR-owned; [OBSERVABILITY.md](../../engineering/observability/standard.md)) |
| Owned updater, runtime-version assert, release staging | release-delivery (engineering system; [desktop-updates.md](../../engineering/ci-cd/desktop-updates.md)) |
| Google Workspace MCP auth/credentials (`commands/google_workspace_mcp*`) | integration_gateway — a desktop-local integration lane hosted by the shell |
| Anonymous telemetry bootstrap | observability infra (product telemetry section) |
| Agent seed archives (contents, pins) | [harnesses.md](../harnesses/README.md); the shell only passes the env |
| Everything the product renders | client surfaces |

> [!decision] PABLO DECIDES: google_workspace_mcp in the shell. 1.4K lines of
> OAuth + credential storage for one integration live as Tauri commands.
> Options: (a) leave (it works, it is desktop-local by design); (b) move behind
> the integration gateway's connection model so desktop-local and cloud
> integrations share one lifecycle. Recommendation: (b) when the
> integration_gateway spec lands; until then it is fenced, not owned, here.

## 8. Code map

```text
apps/desktop/src-tauri/src/
├── lib.rs · main.rs                      setup, state, command registration, menu
├── sidecar.rs · sidecar/{lifecycle,observer,state,diagnostics,tests}.rs   AnyHarness sidecar
├── commands/runtime.rs                   get_runtime_info / restart_runtime
├── commands/cloud_worker.rs · cloud_worker/{launcher,launcher_legacy,lifecycle,
│      observer,spawn,state,tail}.rs      desktop worker launch + supervision
├── commands/keychain.rs                  local secrets (files + data key)
├── commands/config.rs · commands/desktop_identity.rs · app_config.rs · desktop_telemetry_mode.rs
├── commands/{shell,window_chrome,drag_drop,workspace_scratch,process}.rs   native affordances
├── editors/                              editor discovery for open_in_editor
├── quit_flow.rs · workspace_activity_indicator.rs · telemetry.rs
├── agent_seed_env.rs                     seed env passthrough (contents: harnesses)
├── (diagnostics/, diagnostics_collector/, commands/diagnostics.rs, commands/support*.rs → diagnostics)
├── (updater_owned.rs, runtime_version_assert.rs → release-delivery)
└── (commands/google_workspace_mcp* → integration_gateway, fenced)
apps/packages/product-client/src/host/{product-host,desktop-bridge}.ts       the contract
apps/packages/product-client/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.ts
apps/packages/product-client/src/lib/workflows/cloud/                         ensure/teardown desktop worker
apps/desktop/src-tauri/tauri.conf.json · build.rs                             externalBin staging
```

Target: `specs/systems/desktop-host/deep-dive.md` graduates into this file (its contract section is the depth reference until then); no code moves.

## 9. Proof

- Sidecar: [sidecar/tests.rs](../../../apps/desktop/src-tauri/src/sidecar/tests.rs)
  (boot modes, health polling, restart env classes).
- Worker launch: [cloud_worker/tests.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/tests.rs),
  [launcher_tests.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/launcher_tests.rs),
  [tail_tests.rs](../../../apps/desktop/src-tauri/src/commands/cloud_worker/tail_tests.rs).
- Enrollment guard: [use-desktop-worker-enrollment.test.tsx](../../../apps/packages/product-client/src/hooks/cloud/lifecycle/use-desktop-worker-enrollment.test.tsx)
  (identity-key transitions, retry, silent-when-unsupported).
- Config and identity: [app_config_home_env_tests.rs](../../../apps/desktop/src-tauri/src/app_config_home_env_tests.rs),
  [updater_owned_tests.rs](../../../apps/desktop/src-tauri/src/updater_owned_tests.rs) (release-delivery's, listed for completeness).
- Cross-plane: the desktop lanes in [tests/release](../../../tests/release) per [the testing spec](../../engineering/testing/README.md).

## Known gaps / follow-ups

- `launcher_legacy.rs` (non-macOS worker launch with `worker.log`) is dead on
  the macOS-only release matrix; delete with the Windows-lane demotion.
- The enrollment guard is renderer state; a shell-side source of truth for
  "which identity is the worker enrolled under" would let the shell refuse a
  stale ticket without a round trip.
