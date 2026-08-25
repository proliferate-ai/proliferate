# Delivery specification: cull sweep Track E — delete-worker-legacy

Status: frozen delivery specification (governs this PR's delta only).
Source of record: the approved cull sweep (founder-approved 2026-08-25); evidence
ledger in the cull investigation. This track is independent in the sweep's merge
order — mergeable anytime, no rebase dependencies.
Base revision: `698055ff801f22c8c7d81e6de13fa31fae8dde96`.

## Intent

Delete the G1 legacy convergence paths from the managed-runtime system.
Supervisor-owned topology is the only path: the Worker observes divergence and
writes durable mailbox requests; Proliferate Supervisor owns every download,
verification, activation, health gate, and rollback. The Worker-owned in-place
AnyHarness swap, the Worker self-`exec` update, and the one-time D5 bridge (and
the server flag + heartbeat signal that existed only to drive that bridge) all
die.

## Gate: fleet convergence

Run the fleet-convergence check first and record its output in the PR
description. Near-moot with cloud dark: no live sandboxes exist, and desktop
workers are bundled sidecars with update gates disabled. The check verifies
that no deployed Worker's convergence still depends on a legacy path:

1. Desktop workers: the desktop app writes `self_update_enabled = false`
   explicitly and never writes `anyharness_update_enabled` or any bridge field
   (`apps/desktop/src-tauri/src/commands/cloud_worker.rs`); the app bundle owns
   both binaries.
2. Sandbox workers: `build_worker_config` refuses `supervisor_owned=False`
   outright and always emits both legacy gates `false` plus the mailbox dir
   (`server/proliferate/server/cloud/runtime/bootstrap.py`) — every
   provisionable sandbox Worker is a mailbox writer.
3. Launch topology: unconditionally Supervisor-owned since S5-B deleted the
   legacy launch path (2026-07-26 proofs); `settings.supervisor_owned_runtime`
   stopped gating launches then and only gated the D5 heartbeat signal.
4. Cloud is dark in production (gated off; no live sandboxes), so no
   already-provisioned legacy box remains for the D5 bridge to migrate.

## Scope

Rust (`anyharness/crates/proliferate-worker`):

- Delete `src/anyharness_update.rs` (worker-owned pgrep/kill/swap of the
  runtime) and `src/self_update.rs` (worker self-`exec` update).
- Delete the D5-bridge half of `src/supervisor_bridge/` (`bridge/`), the
  `SUPERVISOR_OWNED_TOPOLOGY` constant, and the bridge dispatch in
  `runtime.rs` (`maybe_run_bridge`, `TickControl`). **Keep
  `write_update_request` and the whole mailbox write side** (`mailbox.rs`) —
  the live path. Mailbox tests (deterministic request id, idempotency,
  reconcile/GC) stay untouched and green.
- Delete the legacy branches in `runtime.rs` (`converge_anyharness_runtime`,
  the self-update plan/converge tail); a non-supervisor-owned config now
  heartbeats and syncs but never converges anything.
- Relocate the shared helpers the mailbox path consumes:
  `running_anyharness_version` → `versions.rs`; `artifact_target` /
  `checksum_url_for` → `cloud_client` (crate-private), beside
  `resolve_artifact_location`, which already owns the artifact-identity
  rationale they implement. (The draft named `mailbox.rs`; landing them
  there pushed it past the PROD-SIZE-1 line cap, and the cloud-client home
  is the documented owner of artifact identity.)
- Trim `WorkerConfig`: delete `self_update_enabled`,
  `anyharness_update_enabled`, `anyharness_binary_path`,
  `anyharness_launcher_path`, `anyharness_workdir`, `supervisor_binary_path`,
  `supervisor_config_path`, `supervisor_config_toml`,
  `supervisor_bridge_marker_dir`. **Keep `supervisor_update_request_dir`**
  (the mailbox selector). On-disk configs that still carry deleted keys parse
  unchanged (serde ignores unknown fields).
- Trim dead error variants, the two legacy artifact-download methods on the
  cloud client, the `desired_topology`/`supervisor_bridge` fields of the
  worker's decoded heartbeat ack (a current server still emitting them is
  tolerated as unknown fields), and the store's failed-pin accessors (the
  SQLite schema is untouched).

Server:

- Delete `settings.supervisor_owned_runtime` + its docstring (`config.py`).
- Delete the D5 signal it gated: the `desired_topology`/`supervisor_bridge`
  emission in `record_heartbeat`, `_build_supervisor_bridge_inputs`, and the
  `WorkerSupervisorBridge` ack model fields (`runtime_workers/service.py`,
  `models.py`). Old deployed workers treat the absent fields exactly like
  `None` (both sides ship serde/pydantic defaults). SDK regenerated.
- Adapt the two integration test files; the flag-default pin and the
  R9R-002 bridge-delivery pins die with the feature (flagged for founder
  review in the PR description per constitution).
- `cloud/runtime/bootstrap.py` keeps emitting the (now unread) bridge
  coordinates into sandbox worker configs: that file is dark and dies whole in
  Track A-b; editing it here would only manufacture cross-track conflicts.

Checkers and docs (same PR):

- `scripts/check_proliferate_worker_structure.py` REQUIRED_FILES drops
  `self_update.rs`; `lints/anyharness/worker.toml` file-count prose follows.
  Flagged in the PR description per constitution.
- `specs/FEATURE_DOCS/MANAGED_RUNTIME.md`: G1 gap resolved/removed; legacy
  path references updated.
- `specs/worker.md`: legacy modules leave the module map, ownership table,
  lifecycle narrative, config-reference, and store sections.
- Mentions swept in `specs/supervisor.md`, `specs/TESTING/tier-4-scenario-contract.md`,
  `specs/codebase/platforms/product/agent-distribution.md`,
  `guides/operating/worker-enrollment-failure.md`,
  `specs/FEATURE_DOCS/SANDBOX/lifecycle.md`.

## Non-goals

- No change to the Supervisor crate (it already owns activation end to end).
- No change to the mailbox protocol crate or wire shapes it validates.
- No change to the worker SQLite schema or migrations.
- No change to desktop host code (its explicit `self_update_enabled = false`
  config line is a dead key the worker now ignores; recorded as a follow-up).
- No change to enrollment, identity, launch-options sync, or the
  integration-gateway dotfile paths.

## Salvage

None required: the mailbox path already reproduces the legacy planners'
semantics (planning parity is pinned by `mailbox.rs` tests), and the
Supervisor owns the download/verify/activate machinery the deleted files
implemented. Git history holds the code.

## Traps

- `mailbox.rs` imports helpers from both deleted files — relocate, don't
  delete (`running_anyharness_version`, `artifact_target`, `checksum_url_for`).
- The worker's stamped `--version` output must keep clearing the exact-match
  gate the SUPERVISOR applies at activation (`process::version_output_matches`)
  — the pin in `versions.rs` tests is preserved by inlining the matcher, not
  deleted.
- REL-10 launch-options gate tests drive `heartbeat_and_converge` directly —
  adapt mechanically to the removed `TickControl`, never weaken the gate
  assertions.
- The heartbeat must keep reporting the store-converged AnyHarness version
  (R9-006) — that read moves; it does not die.

## Acceptance

- `cargo check -p proliferate-worker` and worker unit tests green.
- Mailbox-path tests (deterministic request id, idempotency, reconcile/GC)
  untouched and green.
- Server tests green with the flag removed.
- `check_proliferate_worker_structure.py`, update-flow lints, and
  `check_docs.py` green.
- No `self_update`, `anyharness_update` (module), `supervisor_bridge::bridge`,
  `desired_topology`, or `supervisor_owned_runtime` references outside git
  history and historical proof records.
