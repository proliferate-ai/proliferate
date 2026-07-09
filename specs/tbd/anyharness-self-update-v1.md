# AnyHarness Binary Self-Update (Cloud Sandboxes) — v1

Status: design. Owns the mechanism by which a **running cloud sandbox** swaps
its AnyHarness runtime binary in place onto the server's pinned version, plus
the catalog-document model restatement and the doc fixes that follow from it.
Companion to `runtime-worker-supervisor-design.md` (identity/lifecycle) and
`cloud-worker-protocol-design.md` (heartbeat/command contracts). Closes the
gap flagged by `versions.rs` (no launcher exports the runtime version) and the
"known non-mechanism" note in `specs/developing/testing/README.md` §Tier 4.

Not yet built. This spec is the contract for the build; it does not describe
current behavior except where it cites it as ground truth.

## 0. Rulings (fixed; do not relitigate)

- **The worker owns the AnyHarness binary swap** — not the supervisor. Extend
  the worker's existing self-update machinery. The supervisor crate exists in
  the sandbox template but is **never launched** (sandboxes bare-`nohup` the
  runtime and the worker); the supervisor's `update/` module is deliberately
  **out of scope for v1**.
- **The catalog *document* converges live via heartbeat; the binary updates
  separately; `registry.json` (install recipes) rides the binary only.** Three
  independent tracks — see §6.
- **Live sessions may restart across an update.** Only *completion* and
  *restartability* are required; in-flight turns are not preserved.
- **Desktop is unchanged.** The app bundle replaces the sidecars; user-gated.
  Nothing here touches the desktop worker, which keeps `self_update_enabled`
  and this new gate **off**.

## 1. Current state (ground truth)

The heartbeat already carries everything needed except the export and one
server pin:

- **Heartbeat ack** returns `desiredVersions{worker, anyharness, catalogVersion}`
  — `server/proliferate/server/cloud/runtime_workers/service.py` `record_heartbeat`
  (~234-256). `anyharness=pinned_runtime_version()`
  (`server/proliferate/server/version.py` `runtime_version()`),
  `worker=pinned_worker_version()` (`worker_version_pin()`).
- **Worker parses but ignores `anyharness`.** `DesiredVersions.anyharness` is
  `#[allow(dead_code)]` — "convergence is owned by whoever launches the
  runtime" (`anyharness/crates/proliferate-worker/src/cloud_client/mod.rs`
  ~74-78).
- **Heartbeat reports of `anyharness_version` are always `None`.** No launcher
  exports `PROLIFERATE_ANYHARNESS_VERSION`, so
  `versions::anyharness_version()` returns `None`
  (`anyharness/crates/proliferate-worker/src/versions.rs` ~5-20) and
  `cloud_runtime_worker.anyharness_version` stays NULL.
- **Worker binary self-update** already exists and is the template to extend:
  checksummed download via the server redirect, staged next to the current
  binary, `--version` preflight that must report the pinned version, atomic
  rename, then `exec` — `anyharness/crates/proliferate-worker/src/self_update.rs`.
  Gated by `self_update_enabled` (`config.rs` ~20-26), turned on only for
  sandboxes by `build_worker_config` (`server/proliferate/server/cloud/runtime/bootstrap.py`
  ~168-199, `"self_update_enabled": True`).
- **Launch path.** Sandboxes bare-`nohup` the runtime and the worker:
  `_launch_anyharness_runtime` writes and runs the launcher script
  (`.../sandbox_io/connect.py` ~193-291), then `launch_worker_sidecar`
  (`worker_sidecar.py`). The runtime binary lives at a **fixed path**
  (`runtime_context.runtime_binary_path`, staged by
  `server/proliferate/server/cloud/runtime/bundle.py stage_runtime_binary`);
  the launcher script `exec`s that path (`bootstrap.py build_runtime_launch_script`
  ~101-128). This fixed-path + re-run-the-launcher shape is exactly what makes
  an in-place swap tractable.
- **Artifacts.** Released AnyHarness binaries are GitHub Release assets on
  non-draft `runtime-v*` tags, with a `SHA256SUMS` manifest
  (`.github/workflows/release-runtime.yml`).
- **Catalog live sync** already works: heartbeat `catalogVersion` diff → worker
  `GET /v1/catalogs/agents` → `PUT /v1/catalogs/agents` on the runtime →
  runtime validate / atomic-swap / reconcile
  (`anyharness/crates/proliferate-worker/src/catalog_sync.rs`, anyharness
  `domains/agents/catalog/sync.rs`). Startup pin-reconcile bumps agent CLIs /
  ACP adapters to the catalog pins
  (`domains/agents/runtime.rs spawn_startup_pass`; #1052 fix in
  `catalog/service.rs pin_identity`). `catalog.json` + `registry.json` are
  `include_str!`'d (`catalog/bundled.rs`, `registry/bundled.rs`).

## 2. Design

### 2.1 Shape: worker orchestrates, worker stays up

Unlike the worker's own self-update — which ends in `exec` because a
`nohup`'d worker that exits never comes back — the AnyHarness runtime is a
**separate process**. The worker therefore does **not** exec: it stops the
runtime, swaps the binary at the fixed path, relaunches via the existing
launcher, health-checks, and keeps heartbeating. Staying up is what lets the
worker report success/failure, back off, and roll back.

New sibling module `anyharness/crates/proliferate-worker/src/anyharness_update.rs`,
mirroring `self_update.rs` for the pure decision logic (`plan_for_versions`,
`verify_sha256`, `version_output_matches` are reused/shared) and diverging only
in the execution step (swap-external-process instead of exec-self).

Hooked in `runtime.rs heartbeat_and_converge` **after** catalog sync and
**before** worker self-update — a worker self-update execs and never returns,
so any runtime swap must run first on a given tick. Non-fatal like its
siblings: a failed runtime update logs and leaves the current runtime serving.

### 2.2 Gate

New worker-config field `anyharness_update_enabled: bool` (default `false`),
independent of `self_update_enabled` so the two tracks are separately
controllable. Set to `true` only by `build_worker_config` for the sandbox
sidecar; desktop leaves it off. Alongside it, `build_worker_config` writes the
paths the worker needs to act (all already known to `bootstrap.py`):

- `anyharness_binary_path` = `runtime_context.runtime_binary_path`
- `anyharness_launcher_path` = `runtime_launcher_path(runtime_context)`
- `anyharness_workdir` = `runtime_context.runtime_workdir`

The worker already has `runtime_base_url` + `runtime_bearer_token` for the
health probe. No new secret material.

### 2.3 Convergence step (per heartbeat, when `plan` fires)

`plan` reuses the pure logic: act only when
`desiredVersions.anyharness` is non-empty, differs from the running version
(`versions::anyharness_version()` — now populated, see §3), and has not already
been attempted for this exact pin (§2.5).

1. **Download, server-proxied** (see §2.4): fetch the pinned runtime binary for
   this `{os}-{arch}`; fetch its `.sha256` from the binary's *resolved* URL
   (same derive-sibling trick as `self_update.rs`, so binary + checksum share a
   published directory and version). Verify SHA256; reject on mismatch.
2. **Stage + preflight.** Write verified bytes to `.<name>.next.<pid>` beside
   the runtime binary (same filesystem → atomic rename), `chmod 0755`, run
   `--version`; it must succeed **and report the pinned version** (guards the
   unpinned `stable` fallback serving a lagging build — identical rationale to
   the worker preflight). Prereq: the AnyHarness binary must have a `--version`
   that prints the pinned version string; add one if absent.
3. **Stop the runtime only.** Kill *only* the AnyHarness process, by the
   binary's fixed path (`pgrep -f` on `runtime_binary_path`, `[/]`-escaped as in
   `bootstrap.py _pgrep_pattern_for_path`). It must **not** target the worker or
   the shell — do not reuse `build_supervised_runtime_stop_command` wholesale
   (that pattern set includes the worker binary and would kill the orchestrator
   mid-swap). Sessions on the box end here; that is the accepted restart.
4. **Swap atomically, keeping a rollback copy.** Rename current →
   `.<name>.prev`, rename `.next` → the fixed path. A crash between renames
   leaves a runnable binary (old or new) at a known path; stale `.next`/`.prev`
   are swept on the next attempt.
5. **Relaunch** by re-running the on-disk launcher (`anyharness_launcher_path`)
   under `nohup`/detached in `anyharness_workdir`. The launcher `exec`s the
   fixed path, so it launches the swapped binary with no server round-trip and
   the same env — including the version export from §3.
6. **Health-gate + rollback.** Poll runtime health (existing runtime health
   endpoint, worker's `runtime_base_url`). On healthy: record the pin as
   converged, `.prev` swept, done. On unhealthy within the window: restore
   `.prev` over the fixed path, relaunch, mark the pin **attempted-and-failed**
   (§2.5), report. The worker never crash-loops the box.

### 2.4 Download: server-proxied (decision)

**The worker hits the API server, which 302-redirects to the artifact; the
worker never hits GitHub directly.** This matches `worker_artifact_redirect_url`
and the desktop updater, keeps the sandbox free of GitHub egress/credentials,
and gives the T4 test a single server-side feed knob (§5).

Server: add a runtime-artifact redirect parallel to the worker one — e.g.
extend `/v1/cloud/worker/download/{target}/{asset}` with a `runtime`
asset class, or add `/v1/cloud/runtime/download/{target}/{asset}`. It resolves
`runtime_version_pin()` (see §3) to the published `runtime-v{pin}` asset URL
(GitHub Release asset or its CDN mirror), with an unpinned `stable` fallback,
exactly like `worker_artifact_redirect_url` (~259-287). Worker-side, reuse
`download_worker_artifact` / `download_from_url` / `DownloadedArtifact` and the
resolved-URL checksum derivation unchanged.

Checksum shape: the runtime release currently publishes a single `SHA256SUMS`,
whereas the worker relies on a per-asset `<binary>.sha256` sibling. To reuse the
worker's derive-sibling path verbatim, **extend `release-runtime.yml` to also
emit a per-asset `.sha256` next to each runtime asset** (alongside the existing
`SHA256SUMS`). Parity over a bespoke SHA256SUMS-line parser.

### 2.5 Attempt tracking (single retry per pin, no crash-loop)

The worker stays alive across a runtime swap, so — unlike `self_update.rs`,
which carries the marker across `exec` in an env var — the AnyHarness attempt
marker lives in the worker's SQLite store (`WorkerStore`), keyed by the runtime
pin. A pin that failed preflight, swap, or the post-relaunch health gate is
recorded; `plan` skips it until a **newer** pin supersedes it (a lagging
published artifact self-heals on publish; a newer pin always retries). Same
self-healing contract as the worker binary path.

## 3. Report the real version (`PROLIFERATE_ANYHARNESS_VERSION`)

Two coordinated changes make heartbeats report what actually runs:

- **Export at launch.** `build_runtime_env` (`bootstrap.py` ~67-98) adds
  `PROLIFERATE_ANYHARNESS_VERSION` = the runtime version being launched (the
  version staged into the sandbox by `bundle.py`; equivalently
  `runtime_version_pin()` at stage time). The launcher `export`s it, the runtime
  inherits it, and the worker — a sibling process in the same sandbox — reads it
  via `versions::anyharness_version()`. After a §2 swap, the relaunched runtime
  carries the pin the worker just installed, so the next heartbeat reports the
  new version. Delete the `FOLLOW-UP` note in `versions.rs`.
- **Pin only when stamped.** Add `runtime_version_pin() -> str | None` to
  `version.py`, analogous to `worker_version_pin()`: returns `RUNTIME_VERSION`
  or `None`, **not** the `server_version()` display fallback. `record_heartbeat`
  advertises `anyharness=runtime_version_pin()` (not the display
  `runtime_version()`). Rationale is identical to the worker pin: an unstamped
  deployment (local dev, plain `docker build`, self-hosted) must pin **nothing**,
  or the worker would forever chase a `RUNTIME_VERSION`-less artifact that no
  release published and 404-loop. This is safe today because the field is
  parsed-but-dead; it stops being dead the moment §2 ships.

Remove the `#[allow(dead_code)]` on `DesiredVersions.anyharness` when the worker
starts consuming it.

## 4. Failure handling (summary)

Every failure keeps a runnable runtime on the box and never crash-loops:

- **Checksum mismatch / malformed checksum** → abort before staging; current
  runtime untouched; retry next tick.
- **Preflight fail** (spawn fails, non-zero, or reports the wrong version —
  e.g. the `stable` fallback lags the pin) → discard `.next`; no swap; retry
  when the real artifact publishes.
- **Swap/rename error** → best-effort restore; current runtime keeps serving.
- **Post-relaunch health fail** → restore `.prev`, relaunch, mark pin
  attempted-and-failed; do not retry the same pin until it is superseded.
- **Download 404 / server error** → non-fatal; retry next tick.

## 5. Observability & "converged"

- Heartbeat `anyharness_version` reflects the running runtime within one
  interval of any swap (§3); `cloud_runtime_worker.anyharness_version` stops
  being NULL for real sandboxes.
- Structured logs at each step (divergence detected, download, preflight
  result, swap, relaunch, health, rollback), correlated by the worker's already
  bound org/user/sandbox context.
- **Converged** (the T4 assertion) means, for a sandbox: the heartbeat-reported
  `anyharness_version` equals the server's advertised `desiredVersions.anyharness`
  **and** the runtime's active catalog version equals the server's
  `catalogVersion` **and** the installed agent CLIs / ACP adapters match the new
  catalog's pins (the reconcile completed). Binary track and catalog track must
  **both** reach the advertised versions.

## 6. Catalog update model (restated ruling) + doc fixes

Three independent convergence tracks, each with its own feed and cadence:

1. **Catalog document** — converges **live via heartbeat** (`catalogVersion`
   diff → fetch → push → runtime reconcile). No binary change required. Existing.
2. **AnyHarness binary** — converges **separately**, via the mechanism in this
   spec (heartbeat `anyharness` pin → worker download/swap/relaunch).
3. **`registry.json` (install recipes)** — **rides the binary only**. It is
   `include_str!`'d into the runtime; a new registry ships iff a new binary
   ships. It does **not** converge live.

So a sandbox can pick up new *models/metadata* (catalog document) without a new
binary, but new *install/launch/auth recipes* (registry) only arrive with a
binary swap — now possible in place, no longer template-only.

**Docs updated in this PR to match** (they currently assert the binary is
template-immutable / that the catalog only ships with the binary):

- `specs/codebase/structures/anyharness/src/agents.md` — the "Bundled Catalog
  and Registry" section: note the live catalog-document heartbeat sync and that
  `registry.json` rides the binary only.
- `specs/developing/testing/README.md` §Tier 4 — the mechanism table row and
  the "Known non-mechanism" paragraph (sandbox AnyHarness in-place update now
  exists and is specced here; desktop remains bundle-only).
- `specs/developing/testing/flows.md` §Upgrade & release — the flow row and the
  "Known non-mechanisms" paragraph, same correction.

## 7. Testing — T4 contract (Pablo's design, verbatim)

> Install the current released anyharness locally **and** in a cloud sandbox.
> Record the binary version, catalog version, and agent versions on both sides.
> Bump the advertised versions on the API server (binary pin **and** catalog
> version). Wait for the product's own mechanisms to act — **no test-side
> pushing** of binaries or catalogs. Assert both sides updated the **binary**
> **and** reconverged **agent versions** to the new catalog's pins, and that
> cloud and local are consistent. The desktop side is manual-update-then-assert
> (trigger the app-bundle update, then assert), not automatic.

Placement: enters `specs/developing/testing/flows.md` §Upgrade & release as a
Tier-4 row and the tier-4 mechanism table in `README.md`, pointer → this spec,
`—`/not-yet-built until the mechanism lands. It pairs with the existing worker
self-update T4 row and the catalog-convergence rows (`T3-UPDATE-1`): this is the
first row where the **AnyHarness binary itself** converges in a running
sandbox. Feed knobs are server-side (the runtime pin `RUNTIME_VERSION` + the
download base the redirect resolves to), so the test stubs the feed and never
pushes artifacts, matching the tier-4 pattern in `README.md` §Tier 4. The
sandbox scenario must include a live session on the box that the swap restarts
(completion + restartability only). Lives in `tests/release/upgrade/`.

## 8. Out of scope (v1)

- The **supervisor** as the update owner (the crate is never launched;
  revisit only if sandboxes move to supervised launch).
- Preserving **in-flight session turns** across a swap (restart is accepted).
- **Desktop** in-place AnyHarness update (app-bundle replacement stays the
  path; user-gated).
- A bespoke `SHA256SUMS`-line checksum parser (we publish per-asset `.sha256`
  instead — §2.4).
