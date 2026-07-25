# Packet 1b — Custody P1 Handoff (session 2026-07-13 (3), stopped at context guard)

State: this session made NO durable product change. One import line in
`server/proliferate/db/store/workflow_deliveries.py` was briefly edited
(`runtime_payload_digest` → `sha256_hex`) and immediately restored verbatim
before anything else was touched. No test files, models, migration, service,
or domain code were modified. No commit.

- HEAD: `e0f845b6d0049bfd0d4b5670a35e65f507983c1f` (unchanged)
- Branch: `codex/workflows-v1-pr2-execution-spine`
- `git diff --check`: clean (exit 0)
- Working-tree status: identical to the "Session 2026-07-13 (2)" checkpoint
  state (same modified/untracked file set; verified after the revert).

All required context WAS read this session (AGENTS.md, server README, design
§6.3/§7/§8/§16/§21.1, all four store modules, service.py,
domain/invocation.py, utils/canonical_json.py, db/models/workflows.py,
tasks.py, unit helpers, test_workflow_invocation_store.py, the stale
test_workflow_delivery_custody.py, integration helpers + lifecycle test).
The analysis below is complete and verified against the code; the next
session can implement directly from it without re-deriving.

## 1. P1-A — Immutable-run custody boundary (`fix_runtime_payload`)

Defect (verified in code): `workflow_deliveries.fix_runtime_payload` takes the
whole transport envelope `{run, control}` and persists
`canonical_json(<envelope>)` into `runtime_payload_json`, while
`canonical.runtime_payload_digest` hashes only `payload["run"]`. So two
attempts with identical `run` but different caller-supplied `control` (or a
smuggled `expectedDataEpoch`) produce the SAME digest over DIFFERENT persisted
custody — excluded transport fields hide differing custody. Design §7.2 says
custody is the first canonical immutable `run` object only; `{expectedDataEpoch,
run, control}` is reconstructed per attempt from custodied data_epoch +
immutable run + current durable `cancel_requested_at`.

Intended change in `workflow_deliveries.py` (nothing applied):

- Signature: `fix_runtime_payload(db, *, invocation_id, run_json: dict[str, object],
  anyharness_data_epoch: str, expected_target)` — parameter renamed from
  `runtime_payload_json` to `run_json`; it is the immutable run object, never
  the envelope.
- Validation (all `ValueError`, invariant violations not losable races):
  - `anyharness_data_epoch` non-empty (existing).
  - `run_json.get("runId") == str(invocation_id)` (moves the existing check
    from `payload["run"]["runId"]` to the top level).
  - `run_json.get("bundleDigest") == <invocation.bundle_digest>` (existing
    check, now on the top-level object).
  - NEW: reject reserved transport keys — if
    `{"run", "control", "expectedDataEpoch"} & run_json.keys()` is non-empty,
    raise (an envelope passed by mistake, or transport fields smuggled into
    custody). A §6.3 run object has no such keys.
- Digest: `computed_digest = sha256_hex(run_json)` — import changes from
  `runtime_payload_digest` to `sha256_hex` in this module ONLY. Byte-identical
  to `runtime_payload_digest({"run": run_json})`; do NOT touch the
  cross-language twin helper or fixtures (1a golden `runtime-payload.json`
  digest `291c6258…` stays authoritative).
- Persist: `runtime_payload_json=canonical_json(run_json)` — the column now
  unambiguously stores only the run object. No schema/migration change; the
  column name matches design §7.2. `WorkflowDeliverySnapshot.runtime_payload_json`
  therefore reloads as the run object.
- Update module + function docstrings ("{run, control}" language →
  reconstruct-per-attempt language). First-writer CAS conditions, fallback
  SELECT (live statuses + digest NOT NULL + exact target + outcome NULL), and
  everything else stay exactly as-is.

Callsites that pass the envelope today and must pass the run object instead:

- `server/tests/unit/workflow_delivery_helpers.py`: `runtime_payload()`
  (returns `{"run": {...}, "control": {...}}`) → rename to `run_object()`
  returning `{"runId": str(id), "contractVersion": 1, "bundleDigest": "b"*64}`;
  `handoff_and_fix` passes `run_json=`.
- `server/tests/integration/workflow_invocation_helpers.py::_force_accept`
  (lines ~209–222): passes the envelope inline → pass the run dict.
- `server/tests/unit/test_workflow_invocation_store.py`:
  - `test_runtime_payload_with_exponent_values_redigests` (~line 137): builds
    envelope, mutates `payload["run"]["arguments"]`, asserts
    `runtime_payload_digest(reloaded.runtime_payload_json) == digest` →
    build the run object directly with `"arguments": ARGUMENTS`, assert
    `sha256_hex(reloaded.runtime_payload_json) == reloaded.runtime_payload_digest`.
  - `TestDeliveryTransitions.test_handoff_fix_accept_sets_monotonic_evidence`
    (~line 292): `runtime_payload_json=runtime_payload(...)` → `run_json=run_object(...)`.
- `server/tests/unit/test_workflow_delivery_custody.py`: stale, full rewrite
  anyway (see §5).
- No product callsite exists (no delivery handler in 1b) — verified by rg.

## 2. P1-A companion — pure transport-envelope builder

New pure module `server/proliferate/server/workflows/domain/delivery.py`
(domain folder already has `invocation.py` + `validation.py`, so no
single-file-folder issue; pure, no imports beyond stdlib):

```python
def build_runtime_transport_envelope(
    *, run: dict[str, object], expected_data_epoch: str, cancel_requested: bool,
) -> dict[str, object]:
    # validate expected_data_epoch non-empty; run has a non-empty str "runId";
    # reject if run contains reserved keys ("run"/"control"/"expectedDataEpoch")
    return {
        "expectedDataEpoch": expected_data_epoch,
        "run": run,
        "control": {"cancelRequested": cancel_requested},
    }
```

No product caller yet (delivery handlers are a later packet) — the user's
instruction explicitly authorizes exposing + testing it without handlers.
Tests prove: envelope built from a custodied row after a post-handoff cancel
carries `cancelRequested=true`, the FIXED epoch, and the identical run whose
`sha256_hex` still equals the stored `runtime_payload_digest` (re-PUT
reconstruction), and that flipping cancel state never changes the digest.

## 3. P1-B — Acceptance exact-replay workspace fill (`record_delivery_accepted`)

Defect (verified): the replay branch requires
`anyharness_workspace_id.is_not_distinct_from(supplied)` — byte-equal
including NULL. An accept recorded with `anyharness_workspace_id=None` can
never be upgraded by a replay that now knows the workspace, and a replay that
omits it after a filled accept returns None.

Intended rewrite (keeps `anyharness_run_id != str(invocation_id) → None` gate
and the full `custody_conditions` list — handoff NOT NULL, exact digest, exact
epoch, outcome NULL, `exact_target_conditions`):

1. First CAS unchanged: UPDATE `delivering` → `accepted` with all custody
   conditions; values set `anyharness_workspace_id=supplied` (may be None),
   `accepted_at=now`. Returning row → success.
2. NEW monotonic fill (only if `supplied is not None`): UPDATE where
   `status='accepted'`, `anyharness_run_id == supplied_run`,
   `anyharness_workspace_id IS NULL`, plus all custody conditions; values set
   ONLY `anyharness_workspace_id=supplied, updated_at=now` — `accepted_at`
   untouched (preserved). Returning row → success.
3. Replay SELECT: `status='accepted'`, `anyharness_run_id == supplied_run`,
   plus custody conditions, plus `anyharness_workspace_id == supplied` ONLY
   when `supplied is not None` (omitted workspace matches any row). Row →
   idempotent success; else None.

Matrix this yields: initial NULL then value → fill succeeds; omitted →
success; equal → success; conflicting non-null → fill fails (not NULL) and
select fails (≠) → None; any mismatched digest/epoch/target/run → None at
every branch. `ck_wf_delivery_run_binding` already fences foreign run IDs at
the DB.

## 4. Follow-up — terminal-observation cancellation is a no-op

Two coordinated edits:

- `workflow_deliveries.request_delivery_cancel`: add
  `no_terminal_observation_condition()` to the FIRST update (the marker
  write). A row whose projection already shows a terminal AnyHarness status
  (`succeeded|failed|cancelled`) gets no late cancel marker. The second
  update (queued+unoffered → cancelled) needs no change — a queued row cannot
  carry a projection (`ck_wf_delivery_projection_accepted`).
- New pure predicate in `workflow_delivery_custody.py`:
  `has_terminal_observation(delivery: WorkflowDeliverySnapshot) -> bool` —
  `isinstance(observation, dict) and observation.get("status") in
  TERMINAL_OBSERVATION_STATUSES`.
- `service.cancel_workflow_invocation`: enqueue
  `workflows.cancel_managed_run` only when ALL hold: managedCloud target,
  `control_plane_runtime_outcome is None`, status in
  (delivering, accepted), AND NEW `delivery.cancel_requested_at is not None`
  (a marker was actually established/active) AND NEW
  `not has_terminal_observation(delivery)`. Post-handoff nonterminal
  cancellation stays pending exactly as today; only queued+unoffered rows
  local-cancel.

Evidence to add: store test — `request_delivery_cancel` after projecting
`{"status": "succeeded"}` leaves `cancel_requested_at` None and status
accepted; service/API test in the lifecycle file — cancel after a terminal
projection returns 200 with `cancelRequestedAt: null` and
`workflows.cancel_managed_run` outbox count 0.

## 5. Follow-up — lifecycle loss proof uses just-read fields

`server/tests/integration/test_workflow_invocation_lifecycle_api.py`,
`test_cancel_after_runtime_lost_records_marker_without_convergence`
(~lines 213–225): the delivery IS re-read before the loss call; change the
kwargs to use it — `expected_runtime_revision=delivery.runtime_revision`
(not hardcoded None), `expected_data_epoch=delivery.anyharness_data_epoch`
(not ACCEPT_EPOCH), and assert `delivery.anyharness_data_epoch is not None`
alongside the existing digest assert.

## 6. Custody test rewrite (stale file, 466 lines of pre-split API)

`server/tests/unit/test_workflow_delivery_custody.py` is untouched old-API
code (imports `workflow_invocations as store`, calls deleted
`record_runtime_lost` generic / `record_delivery_cancelled_target_converged`
/ `expected_cloud_sandbox_id=` / target-less handoff+fix). Full rewrite
against the split modules; PLAN: split into two files, each < 600 lines
(MAX_LINES=600 applies to server tests):

File 1 `test_workflow_delivery_custody.py` — payload/acceptance/failure/DB:
- TestPayloadCustody: digest recomputed (== sha256_hex(run)); foreign runId
  ValueError; NEW reserved transport keys in run_json ValueError (proves
  control/expectedDataEpoch can never enter custody); queued (no handoff) and
  cancelled rows cannot fix; first-writer race (two fixers, different
  non-reserved run field + different epochs, fresh post-race session) proving
  the ATOMIC run/digest/epoch tuple — stored run marker, digest, epoch all
  from one writer and digest == sha256_hex(stored run); fallback SELECT
  returns None on a lost row; managed sandbox immutable once bound (rebind
  with sbx-2 refused, same sbx re-handoff ok); NEW re-PUT reconstruction via
  `build_runtime_transport_envelope` from custodied row + current durable
  cancel state (see §2).
- TestAcceptanceCustody: premature from queued None; mismatched custody
  parametrize (wrong digest / wrong epoch / ManagedCloudTarget("sbx-other") /
  foreign run id); wrong target KIND both directions (managed invocation +
  DesktopTarget, desktop invocation + ManagedCloudTarget) → None; TRUE
  desktop accept — invocation seeded `target_kind="desktop",
  desktop_install_id=DEFAULT_INSTALL`, handoff/fix/accept with
  DEFAULT_DESKTOP_TARGET, cloud_sandbox_id stays NULL; exact replay
  idempotent success; workspace fill matrix per §3 (initial NULL→value fill
  preserving accepted_at; omitted; equal; conflicting → None; fill attempt
  with mismatched digest/epoch/target/run → None).
- TestFailureCustody: failed_before_handoff only from queued/unoffered and
  never over a cancel marker; failed_after_handoff exact
  digest/epoch (`None` expecteds legal pre-fix), wrong digest/epoch/target →
  None; cannot overwrite accepted / cancel-pending / lost.
- TestDatabaseConstraints (raw SQL, IntegrityError, rollback after each):
  accepted-without-custody; outcome-without-handoff; NEW foreign
  `anyharness_run_id` (`ck_wf_delivery_run_binding`); NEW cancelled row with
  any custody field (`ck_wf_delivery_cancelled_unoffered`).

File 2 (new) `test_workflow_delivery_loss.py` — loss + cancellation:
- TestRuntimeLost: all three proof APIs — epoch_changed raises ValueError on
  same/empty observed epoch and returns None on wrong expected epoch;
  accepted_run_absent returns None on a merely delivering row (a delivering
  same-epoch 404 is a re-PUT, NOT loss) and works after accept;
  sandbox_destroyed with wrong-sandbox target None; revision fence (project
  rev N, loss expecting stale rev None, expecting N wins); target/digest/
  epoch/run fences; one-shot; never revived (handoff, accept, fix fallback,
  both failed_* fns, converge all None after loss); loss-first freezes later
  projections; terminal-first (`{"status":"succeeded"}` projection) blocks
  loss; foreign-run projection rejected.
- TestCancellation: queued+unoffered request_delivery_cancel is terminal;
  post-handoff delivering stays delivering with marker and UNCHANGED
  payload/digest/epoch (exact re-PUT custody); accepted keeps pending marker;
  `record_delivery_cancelled_converged` None once handoff evidence exists and
  None when already terminally cancelled; NEW no marker after terminal
  observation (§4 store evidence); marker is first-write-wins.

Helper updates (`tests/unit/workflow_delivery_helpers.py`): rename
`runtime_payload` → `run_object` returning the bare run dict; `handoff_and_fix`
passes `run_json=`; `accept_delivery` gains `anyharness_workspace_id=None`
passthrough. `lost_proof_kwargs` already correct.

## 7. Evidence battery for the mini-packet (unchanged from mission)

```
cd server
uv run ruff check proliferate/db/store proliferate/server/workflows tests/unit tests/integration
uv run pytest tests/unit/test_workflow_invocation_store.py \
  tests/unit/test_workflow_delivery_custody.py tests/unit/test_workflow_delivery_loss.py -q
uv run pytest tests/integration/test_workflow_invocation_lifecycle_api.py -q   # if easy
python ../scripts/check_max_lines.py && python ../scripts/check_server_boundaries.py
git diff --check
rg -n "record_runtime_lost\(|record_delivery_cancelled_target_converged|expected_cloud_sandbox_id|record_delivery_failed\(" server/tests server/proliferate
```
Reminder: the test DB persists between runs and the migration is
create-table-guarded — drop/recreate if constraint-dependent tests fail
mysteriously. Model/migration CHECKs must stay byte-identical (25/25); none of
the planned edits touch schema, so no migration change is expected.

## 8. Not in scope next session (unchanged)

Board A/B/F/J/K, store-folder P2, generated SDK regen, broad races, commits.

## Product implementation checkpoint (session 2026-07-13 (4)) — P1 §1–§5 DONE, GREEN

HEAD `e0f845b6d0049bfd0d4b5670a35e65f507983c1f` unchanged, branch
`codex/workflows-v1-pr2-execution-spine`, `git diff --check` clean, no commit.

### Files changed this session (exactly these)

- `server/proliferate/db/store/workflow_deliveries.py` — §1: `fix_runtime_payload`
  now takes `run_json` (bare immutable run), rejects reserved transport keys
  (`run`/`control`/`expectedDataEpoch`, module const `_RESERVED_TRANSPORT_KEYS`),
  validates top-level `runId`/`bundleDigest`, digest = `sha256_hex(run_json)`
  (import swapped from `runtime_payload_digest`), persists
  `canonical_json(run_json)`; CAS/fallback fences untouched. §3:
  `record_delivery_accepted` — first CAS unchanged; NEW monotonic workspace-fill
  UPDATE (accepted + same run + workspace IS NULL + full custody, sets only
  workspace/updated_at, `accepted_at` preserved); replay SELECT matches workspace
  only when supplied. NEW ValueError on empty expected digest / empty epoch /
  empty-string supplied workspace (user-added validation). §4:
  `request_delivery_cancel` first update gains `no_terminal_observation_condition()`.
  Docstrings updated to reconstruct-per-attempt language.
- `server/proliferate/db/store/workflow_delivery_custody.py` — NEW pure
  `has_terminal_observation(delivery)` predicate.
- `server/proliferate/server/workflows/domain/delivery.py` — NEW pure module:
  `build_runtime_transport_envelope(run, expected_data_epoch, cancel_requested)`
  + `RESERVED_TRANSPORT_KEYS` (§2; constant intentionally duplicated in the
  store to preserve layering — db/store must not import server domain).
- `server/proliferate/server/workflows/service.py` — cancel enqueue gate adds
  `delivery.cancel_requested_at is not None` and
  `not has_terminal_observation(delivery)`; import added.
- `server/tests/unit/workflow_delivery_helpers.py` — `runtime_payload` →
  `run_object` (bare run dict); `handoff_and_fix(run_json=)`; `accept_delivery`
  gains `anyharness_workspace_id` passthrough.
- `server/tests/unit/test_workflow_invocation_store.py` — exponent test builds
  bare run, asserts `sha256_hex(reloaded.runtime_payload_json) == digest`;
  monotonic-evidence test uses `run_json=run_object(...)`; imports updated.
- `server/tests/integration/workflow_invocation_helpers.py` — `_force_accept`
  passes the bare run dict via `run_json=`.
- `server/tests/integration/test_workflow_invocation_lifecycle_api.py` — §5 lost
  test uses `delivery.runtime_revision` + `delivery.anyharness_data_epoch`
  (asserted non-None); NEW `test_cancel_after_terminal_observation_is_a_no_op`
  (200, `cancelRequestedAt: null`, cancel outbox count 0); dropped now-unused
  `ACCEPT_EPOCH` import.
- NEW `server/tests/unit/test_workflow_delivery_run_custody.py` (focused P1
  suite, real Postgres): reserved-keys/envelope-as-run ValueError, bare-run
  custody + digest, envelope reconstruction (post-handoff cancel →
  cancelRequested=true, fixed epoch, digest stable across cancel flips),
  envelope validation, workspace-fill matrix (NULL→fill preserving accepted_at,
  omitted/equal, conflicting → None, wrong digest/epoch fill → None), empty
  acceptance-field ValueErrors, terminal-projection cancel writes no marker.

### Evidence (all run this session, all green)

- `uv run ruff check` on all 9 touched files: All checks passed.
- `uv run pytest tests/unit/test_workflow_invocation_store.py tests/unit/test_workflow_delivery_run_custody.py -q` → 30 passed.
- `uv run pytest tests/integration/test_workflow_invocation_lifecycle_api.py -q` → 8 passed.
- `uv run pytest tests/integration/test_workflow_invocations_api.py tests/integration/test_workflow_invocation_request_custody.py -q` → 31 passed (they use `_force_accept`).
- `uv run pytest tests/unit/test_workflow_canonical.py -q` → 38 passed (twin
  helper + golden fixture untouched, digest `291c6258…` still authoritative).
- `python3 scripts/check_max_lines.py` + `python3 scripts/check_server_boundaries.py`
  → both passed (note: `python3`, plain `python` is absent).
- `git diff --check` clean; working-tree file set = prior checkpoint plus the
  two NEW files above.
- rg sweep: only old-API callsites left are inside the intentionally stale
  `server/tests/unit/test_workflow_delivery_custody.py` (helper `runtime_payload(`
  ×3, `runtime_payload_json=` ×1, `runtime_payload_digest(` ×2 — it will fail
  collection until its §6 rewrite) and the deliberately untouched
  `utils/canonical_json.py` / `test_workflow_canonical.py` twin.

### Remaining work (next session)

- §6 full rewrite of `test_workflow_delivery_custody.py` into two <600-line
  files (custody + loss/cancellation battery) — that file currently fails
  collection (old API + renamed helper import), so exclude it from pytest runs
  until rewritten.
- Board A/B/F/J/K, store-folder P2, SDK regen, broad races, commits — out of
  scope per §8.

## Independent test-acceptance follow-up (2026-07-13) — GREEN

The first independent review accepted the product semantics but rejected the
initial evidence as incomplete. A fresh Fable 5 session closed those gaps; a
provider-side 429/503 prevented its final prose response, but all edits landed
atomically and the integration captain independently reran the final gates.

Additional evidence now present:

- `test_workflow_delivery_run_custody.py`
  - committed bare-run/digest/data-epoch reload through a fresh session;
  - managed wrong-sandbox, managed→desktop wrong-kind, foreign-run, desktop
    wrong-install, and desktop→managed wrong-kind workspace-fill fences;
  - real PostgreSQL two-writer NULL→distinct-workspace race using independent
    sessions and transactions, with exactly one winner and a fresh third-session
    read proving the workspace winner and unchanged `accepted_at`;
  - terminal-cancel no-op parameterized over `succeeded`, `failed`, and
    `cancelled`, plus a `running` negative proving the marker is written.
- `workflow_invocation_helpers.py`
  - new `_outbox_count_for_invocation` query matches task name plus JSONB
    invocation ID without assuming an idempotency-key shape.
- `test_workflow_invocation_lifecycle_api.py`
  - terminal-cancel no-op now asserts no convergence task under any key;
  - the handoff-cancel path is a positive control proving the key-agnostic
    query sees the one expected task.

Final evidence:

- Fable: focused ruff clean; invocation-store + focused custody suites →
  `36 passed in 36.13s`.
- Integration captain: focused custody suite → `19 passed in 24.59s`;
  focused ruff clean; lifecycle API suite → `8 passed in 18.32s`;
  `git diff --check` clean.
- Product acceptance reviewer: accepted with no P0/P1/P2 findings.

The P1 §1–§5 product mini-packet and its focused acceptance evidence are now
accepted. The intentionally stale broad custody suite remains the next task.

Final reviewer addendum: a running-observation API cancellation test now proves
the service writes the marker and enqueues exactly one convergence task.
