# Workflows V1 PR2 — Execution Spine — Checkpoint

Branch: `codex/workflows-v1-pr2-execution-spine`
Base (PR1 HEAD): `f7ccfb625cc2534d2a26fd89750c00277edc48c9`
Locked design: `specs/tbd/workflow-execution-spine-pr2.md` in the pr2-design worktree,
checksum `d99ec96b5b8eca4c466de144ca1852574deae8d989c505f17a035e7d835137b3`.

## Packet 1a — COMMITTED `e108f6113`

feat(workflows): add cross-language RFC 8785 canonical JSON and digests

Scope (13 files, +990/-2):
- `anyharness/crates/anyharness-contract/src/canonical.rs` (+ lib.rs export,
  crate deps ryu/sha2, workspace serde_json `float_roundtrip` + ryu)
- `server/proliferate/server/workflows/domain/canonical.py`
- `apps/packages/product-domain/src/workflows/canonical.ts` (+ package export)
- Shared golden fixtures `fixtures/contracts/workflow-run/`
  (canonical-cases.json, resolved-bundle.json) consumed by all three suites
  from the SAME files
- `specs/codebase/structures/anyharness/contract.md`: canonical.rs ownership +
  cross-language validation posture
- Note: Cargo.lock also trues up stale `proliferate 0.3.25 -> 0.3.27`
  (release-prep commit `79e68a590` bumped the crate without regenerating the
  lock; cargo synced it during our builds — intentional to include).

### Adversarial review (one read-only opus reviewer, cross-language correctness)

Verified sound: number formatting (Rust ryu formatter byte-equal to JS
`Number::toString` on 53k+ values incl. subnormals/thresholds; Python equal on
20k+), UTF-16 key sort in all three, minimal escaping, no NFC normalization,
digest = SHA-256 over UTF-8 canonical bytes lowercase hex no prefix, fixture
hygiene (single shared files), NaN/Inf rejection, 2^53 boundary.

Finding 1 (major): Rust's exact-range guard only covers literals fitting
i64/u64; integer literals overflowing u64/i64 fall to serde_json's f64 arm and
are accepted while Python rejects. Resolution: the reviewer's proposed
value-based rejection (integral f64 > 2^53) would break the golden fixtures
(RFC §3.2.3 example `1e+30`, `9007199254740994.0`, `1e21`…) and Python/TS
float parity — post-parse the overflowed literal is indistinguishable from a
float literal (same as `JSON.parse` in TS, already documented there). Ruling:
posture made explicit and PINNED — each language rejects where its parser
preserves exactness (Python: every int literal; Rust: i64/u64-fitting, now
incl. u64::MAX/i64::MIN edge tests); beyond that Rust/TS emit byte-identical
ECMAScript-rounded doubles (new tests pin `2^64 -> "18446744073709552000"`
etc. in BOTH Rust and TS); Python at the Cloud write boundary is the strict
gate so such literals never reach a stored payload. Documented in module docs
+ contract.md. CARRIED TO 1b: canonicalization ValueError at the API ingress
must map to a structured 400 validation error, never a 500.

Finding 2 (minor): lone-surrogate strings previously diverged three ways (TS
digested them; Python canonical_json passed but canonical_bytes crashed; Rust
rejects at parse). Resolution: uniform rejection — Python raises ValueError in
`_serialize_string` (covers keys+values), TS throws via code-unit lone
surrogate regex (lib is ES2021, no `isWellFormed` types), Rust parse rejection
pinned by test. No digest exists for them in any language.

### Evidence (rerun after fixes)

- `server` `uv run pytest tests/unit/test_workflow_canonical.py -q`: 32 passed
- `cargo test -p anyharness-contract`: 36 passed (unit) — incl. new
  `integer_literals_overflowing_u64_follow_ecmascript_rounding`,
  `lone_surrogate_escapes_are_rejected_at_parse`
- product-domain `vitest run src/workflows/canonical.test.ts`: 7 passed;
  `tsc --noEmit`: clean
- repo-shape: anyharness boundaries, max-lines, server boundaries, frontend
  boundaries — all passed
- Earlier full-suite evidence (pre-review, code unchanged outside canonical
  files): server unit 46 passed (canonical+PR1 definitions),
  `cargo test -p anyharness-lib` 987 passed / 1 ignored,
  `cargo check --workspace` clean (4 pre-existing warnings)

## Packet 1a correction — COMMITTED `e0f845b6d`

fix(workflows): scope bundleDigest and runtimePayloadDigest per design §6.3

Independent Codex audit found the 1a golden fixtures pinned digests over the
wrong boundary. Verified independently and corrected:

- `resolved-bundle.json` hashed the whole wrapper (incl. `contractVersion`,
  `runId`) as `a1896ae5…`; now pins `bundleDigest` over ONLY definition +
  arguments + resolvedStages + resolvedPlacement = `dbc37e73080a9008…`
  (matches the auditor's independent computation).
- New `runtime-payload.json` pins `runtimePayloadDigest` over ONLY the
  immutable `run` object = `291c6258113819c5…` (matches auditor);
  `expectedDataEpoch` and `control.cancelRequested` proven excluded by
  mutation tests. The `workflow-control-envelope` case in
  canonical-cases.json remains as a pure canonicalization golden.
- Scope-enforcing helpers added to all three twins: Python/Rust
  `bundle_digest`/`runtime_payload_digest` (Rust gains
  `CanonicalJsonError::DigestScope`), TS `bundleDigestJson`/
  `runtimePayloadDigestJson` (no crypto in the browser-safe package; callers
  hash the returned canonical text). Mutation tests in all three languages
  prove wrapper exclusion + per-member coverage.
- TS canonicalizer hardened: non-plain objects (Date/Map/Set/class instances)
  are rejected instead of canonicalizing as `{}`; null-prototype objects
  accepted; nested rejection tested.
- contract.md pins digest scopes as part of the cross-language contract.
- WIP invocation.py's wrong whole-bundle `bundle_digest` deleted (call sites
  must use `canonical.bundle_digest`); that file stays uncommitted 1b WIP.

Evidence: Python 38 passed; `cargo test -p anyharness-contract` 42 passed;
product-domain vitest 14 passed + `tsc --noEmit` clean; all four repo-shape
checks passed.

## Next packet: 1b — Cloud invocation/delivery plane

Immutable invocation/delivery models, Postgres migration/stores, user
invoke/history/detail/cancel/managed-abandon routes, idempotency/request
digests (`requestHash`, `bundleDigest`, `runtimePayloadDigest` per design
§6.x), outbox atomicity. Plus carried item: map canonicalization errors to
400s at ingress.

Remaining program after 1b: 1c AnyHarness HTTP contract + SQLite acceptance;
2 generic session control/claims; 3 workspace/session preparation; 4
sequential durable actor; 5 managed direct delivery; 6 desktop
heartbeat/worker; 7 typed UI/projections + test tiers; final adversarial
reviews → push + draft PR (no merge/deploy).

## Standing rules

Sole writer = main thread; subagents discover/test/review only (read-only),
never Fable, model always explicit. At 80–85% context: finish atomic packet,
commit, update this file, STOP. Never compact. Profile isolation per
CLAUDE.md if the app must be booted.

## Packet 1b — IN PROGRESS, UNCOMMITTED (session 2026-07-13, stopped at context guard)

Working tree on `codex/workflows-v1-pr2-execution-spine` holds the full 1b WIP
(see `git status`); do NOT reset/clean. Base commit unchanged: `e0f845b6d`.
All touched modules import cleanly; no half-edit from the interrupted session.

### Verified green right now (2026-07-13)

- Unit: test_workflow_invocation_domain / _store, test_workflow_delivery_custody,
  test_background_outbox, test_workflow_canonical — 109 passed.
- Integration (real PG): test_workflow_invocations_api,
  test_workflow_invocation_lifecycle_api, test_workflow_invocation_request_custody
  — 38 passed. Total 147 passed.
- Ruff clean on workflows + store; `check_server_boundaries.py` passes;
  one alembic head (`c4d5e6f7a8b1`); git diff --check clean.

### Audit board A–K (per user's independent audit 2026-07-13 + subagent verify)

DONE this session:
- I: lone-surrogate typed exact 400. Root cause: pydantic `model_dump(mode="json")`
  replaces lone surrogates with U+FFFD before the service scan. Fix: raw
  `model_validator(mode="before")` on `WorkflowInvocationCreateRequest`
  (models.py) raising `InvalidWorkflowInvocation` (propagates — not a
  ValueError — to the app handler as structured 400) + `scrub_lone_surrogates`
  in domain/invocation.py so the echoed path stays UTF-8 encodable.
- G: advisory lock moved into store as
  `workflow_invocations.acquire_invocation_idempotency_lock` (pg_advisory_xact_lock
  keyed `workflow_invocation:{user_id}:{key}`, before first SELECT); raw SQL
  removed from service.py — this cleared both server-boundary violations.
  Ruff import-order + fixes applied.

REMAINING (exact gaps, verified against code):
- A: canonical TEXT custody done; PG round-trip matrix in
  test_workflow_invocation_store.py::TestCanonicalNumericCustody lacks 1e20,
  5e-324, max finite (1.7976931348623157e+308) and does not reopen a NEW
  session/connection before reload (siblings in same file show the pattern).
- B: service.py `_resolve_placement` emits flat setupScript/runCommand under
  `repository`; required nested `repository.setupConfig.{setupScript,runCommand}`
  with explicit "" empties, frozen under bundleDigest; add
  new-key-after-invocation coverage; update shared golden
  fixtures/contracts/workflow-run/resolved-bundle.json + digests in ALL THREE
  languages (Python/Rust/TS twins).
- C: store `record_runtime_lost` CAS only checks enum+expected epoch; needs
  proof-specific observed status/target/revision CAS, terminal-observation
  precedence, DB CHECK for reason enum (epoch_changed/accepted_run_absent/
  sandbox_destroyed), race test. Also: acceptance exact-replay idempotency is
  NOT implemented — `record_delivery_accepted` matches only status=delivering;
  a replayed identical accept returns None (must be success).
- D: projection CAS (`update_runtime_projection`) lacks exact digest/epoch/target
  proof; DB lacks digest hex-format CHECKs (bundle_digest,
  runtime_payload_digest are plain String(64)) and runId==invocation
  enforcement. Model + migration must stay in parity (they are byte-identical
  today; keep it that way).
- E: target-converged cancel (`record_delivery_cancelled_target_converged`)
  epoch-bound only; add structured target proof (run/workspace identity) and
  TRUE concurrent cancel-vs-accept / cancel-vs-failure races (current tests
  are sequential orderings).
- F REGRESSION: relay uses include-allowlist (`task_names=SUPPORTED_OUTBOX_TASKS`,
  only HEALTH_NOOP_TASK) → unknown tasks pend forever and relay.py:96-109
  unsupported_task branch is dead code. Required: generic
  claim_due_outbox_tasks(excluded_task_names=...) NOT IN before
  order/limit/SKIP LOCKED, excluding ONLY reserved workflow task names
  (tasks.py constants); unknown nondeferred names must claim+fail; rewrite
  masking test test_background_outbox.py::test_relay_leaves_unregistered_task_
  pending_and_unclaimed accordingly; deferred workflow rows stay pending/
  attempt_count=0/unlocked, no starvation.
- H: abandon gate lacks locked re-read (SELECT FOR UPDATE) of
  accepted/live/custodied + cleanup-blocked proof before enqueue; scoped
  idempotency exists (revision-keyed) but handler recheck semantics + custody
  proof in kwargs still needed; poisoning test required.
- J: duplicate-session rejection done; managed workspace lookup
  `get_cloud_workspace_by_anyharness_id` is globally unscoped → another
  user's workspace with the same target-local ID wrongly rejects. Make
  owner-scoped: owned active pass, owned archived reject, unknown/desktop
  defer, foreign same-ID irrelevant (defer).
- K: races/rollback battery incomplete: first-request idempotency (exists),
  cancel-vs-accept, loss-vs-terminal, concurrent projections,
  transaction/outbox rollback, abandon poisoning, relay deferral/starvation.
- Canonical module location: staged rename put it at
  proliferate/utils/canonical_json.py; audit says generic utils bucket
  conflicts with server ownership guidance — choose ownership-correct shared
  location (check scripts/check_server_boundaries.py rules) and update
  imports (models/store/service/domain + tests).
- Then: full 1a+1b targeted tests, fmt/lint/type/boundary/migration-head/
  OpenAPI + cloud SDK regen check, fresh read-only adversarial review (never
  Fable, explicit model), fix findings, single atomic commit, update this
  file with the SHA. Do not push.

### State rules (pinned for next session)

live := control_plane_runtime_outcome IS NULL.
custodied := handoff_started_at AND payload AND digest AND data_epoch present.
Acceptance only delivering->accepted when live+custodied+exact
invocation/digest/epoch/target; exact replay allowed. Projection only
accepted+live+exact custody+increasing revision. Loss-first fences later
work; terminal-first blocks loss.

## Session 2026-07-13 (2) — C/D/E/H batch + store split, STOPPED AT CONTEXT GUARD MID-TEST-REPAIR

Working tree still uncommitted on base `e0f845b6d`. `git diff --check` clean
(exit 0). PRODUCT CODE for C/D/E/H + the independent audit's P0 split and
P1 correctness items is DONE and import-clean; TEST REPAIR IS UNFINISHED —
the unit/integration test files still call the pre-split module and deleted
APIs, so the focused suites DO NOT PASS right now (last full run before the
split: 22 failed / 87 passed, all failures = stale old-API callsites).

### Completed this session (product code — do not redo)

1. Model + migration (byte-identical pair, verified by eye):
   - `proliferate/db/models/workflows.py` and
     `alembic/versions/c4d5e6f7a8b1_workflow_invocations_v1.py`
   - `ck_wf_delivery_cancelled_unoffered` EXPANDED (P1-3): cancelled implies
     handoff/digest/run/workspace/revision/accepted_at/outcome ALL NULL.
   - NEW `ck_wf_delivery_run_binding` (P1-4):
     `anyharness_run_id IS NULL OR anyharness_run_id = invocation_id::text`.
2. Store split (P0 max-lines: old single file was 953 > 700 hard limit).
   Four direct-import modules, NO barrel; old
   `db/store/workflow_invocations.py` (delivery half) is GONE:
   - `workflow_delivery_custody.py` (221): status constants,
     TERMINAL_OBSERVATION_STATUSES, ManagedCloudTarget/DesktopTarget/
     ExpectedDeliveryTarget, both Snapshot dataclasses + builders
     (`invocation_snapshot`/`delivery_snapshot`), `parse_document`,
     `invocation_target_exists`, `exact_target_conditions`,
     `no_terminal_observation_condition`.
   - `workflow_invocations.py` (175): idempotency lock, insert/get/
     get_by_idempotency_key/list (list joins delivery; still valid for
     test_workflow_invocations_api.py).
   - `workflow_deliveries.py` (512): insert/get/get_for_update,
     request_delivery_cancel, record_delivery_cancelled_converged
     (queued+unoffered only — ALL target-converged local-cancel paths are
     deleted per E), mark_delivery_handoff_started, fix_runtime_payload,
     record_delivery_accepted (exact replay = success),
     record_delivery_failed_before_handoff + record_delivery_failed_after_handoff
     (P1-2 split; after_handoff takes expected digest/epoch as
     is_not_distinct_from + exact typed target; generic
     record_delivery_failed DELETED), update_runtime_projection.
   - `workflow_delivery_loss.py` (187): `_record_runtime_lost` shared CAS +
     the 3 proof APIs record_runtime_lost_epoch_changed /
     _accepted_run_absent / _sandbox_destroyed (C). Generic
     record_runtime_lost DELETED.
   - P1-1 applied in fix_runtime_payload: write CAS requires
     status='delivering' + handoff NOT NULL + outcome NULL; fallback SELECT
     requires digest NOT NULL + status in (delivering,accepted) + outcome
     NULL + exact target.
3. Callsite updates DONE: `server/workflows/service.py` (new
   `delivery_store` alias for all delivery fns + DELIVERY_STATUS_*;
   snapshots now from workflow_delivery_custody), `server/workflows/models.py`
   (snapshot import moved). api.py needed no change.
4. Evidence captured: `uv run python -c "import service/api/models"` OK;
   `ruff check` on the 4 new store modules + server/workflows/ → "All checks
   passed!". Module sizes 221/175/512/187 all < 700.
   Earlier partial test edits already landed: unit
   `tests/unit/workflow_delivery_helpers.py` fully converted to split modules
   + new API (delivery_store/invocation_store aliases, lost_proof_kwargs
   helper present); integration `workflow_invocation_helpers.py` got
   ACCEPT_TARGET + bundleDigest-in-payload + exact projection custody
   (signatures fixed) BUT still imports/calls via the old
   `workflow_invocations` alias for delivery fns — module must be switched.
   Integration lifecycle test line ~116 handoff got expected_target=
   ACCEPT_TARGET but same alias problem.

### NOT DONE — exact remaining work (in order)

1. Stale-callsite repair (static count just measured):
   - `tests/integration/workflow_invocation_helpers.py`: 5 delivery calls
     (lines ~201/209/224/243/248) via `invocation_store.` → import
     `workflow_deliveries as delivery_store` and repoint.
   - `tests/integration/test_workflow_invocation_lifecycle_api.py`: line
     ~116 `invocation_store.mark_delivery_handoff_started` (repoint), line
     ~212 `invocation_store.record_runtime_lost(...proof="sandbox_destroyed")`
     → `workflow_delivery_loss.record_runtime_lost_sandbox_destroyed` with
     expected_status="accepted", expected_runtime_revision=None (row is
     freshly force-accepted, no projection yet), digest/epoch read off the
     delivery, expected_target=ACCEPT_TARGET.
   - `tests/unit/test_workflow_invocation_store.py`: imports
     `workflow_invocations as store` — every delivery-transition call must
     move to delivery_store; stale signatures at lines ~264-295 (handoff
     cloud_sandbox_id kwarg → expected_target=DEFAULT_TARGET; fix without
     target; accept_delivery(..., cloud_sandbox_id=) → helper defaults),
     ~321, ~350 (handoff no target), ~395-415, ~435-442 (projection missing
     digest/epoch/target → use project_observation helper), plus
     record_delivery_failed → record_delivery_failed_before_handoff (queued
     cases at ~362) / record_delivery_failed_after_handoff (delivering cases
     at ~304, ~328).
   - `tests/unit/test_workflow_delivery_custody.py`: 16+ stale hits — full
     rewrite planned (was drafted, NOT written). Old file still calls
     record_runtime_lost generic (5×), record_delivery_cancelled_target_converged
     (4×), expected_cloud_sandbox_id (5×), handoff/fix without target.
     Planned structure (keep <600 lines — MAX_LINES=600 applies to
     server/tests!): TestPayloadCustody (digest recompute; foreign runId
     ValueError; NEW queued/cancelled rows cannot fix (P1-1); first-writer
     race; NEW fallback returns None on lost row; sandbox immutability via
     targets), TestAcceptanceCustody (premature; mismatched custody
     parametrize with ManagedCloudTarget(sbx); desktop accept via seeded
     desktop invocation + DEFAULT_DESKTOP_TARGET; exact-replay idempotent
     success + mismatched replay None; wrong target kind), TestRuntimeLost
     (all 3 proof APIs exercised: epoch_changed ValueError on same/empty
     observed epoch + wrong expected epoch None; accepted_run_absent None on
     delivering then works after accept; sandbox_destroyed wrong-sandbox
     None; one-shot; never-revived incl. both failed_* fns; revision-bound
     freeze; both orderings; foreign-run projection), TestCancellation (E:
     post-handoff cancel stays delivering + marker + UNCHANGED payload/
     digest/epoch for exact re-PUT; accepted keeps pending marker;
     unoffered-queued terminal; converged None post-handoff),
     TestFailureCustody (P1-2 matrix), TestDatabaseConstraints (2 existing +
     NEW run-binding raw-SQL rejection + NEW cancelled-with-custody raw-SQL
     rejection). If it exceeds ~600 lines, split races into
     `tests/unit/test_workflow_delivery_races.py`.
2. NEW race tests (K subset for this batch), real PG via test_engine +
   async_sessionmaker + asyncio.gather:
   - cancel-vs-accept (delivering+fixed) → final accepted + marker set.
   - cancel-vs-failure (queued: cancelled XOR failed_before_handoff;
     delivering: marker+refused-failure XOR failed-no-marker).
   - loss-vs-terminal-projection (accepted rev1 running; gather project rev2
     status=succeeded vs record_runtime_lost_accepted_run_absent expecting
     rev1) → assert NOT(terminal projection AND runtime_lost); exactly one
     of the two consistent finals.
   - abandon-vs-loss (service.abandon_workflow_invocation holds FOR UPDATE;
     gather with loss) → if WorkflowAbandonNotAvailable raised then abandon
     outbox count 0 else count 1 with revision-scoped key; loss lands either
     way. CLEANUP_BLOCKED_OBSERVATION constant: status=finalizing +
     error.code=workflow_session_cleanup_requires_abandon.
3. Run focused suites (from `server/`):
   `uv run pytest tests/unit/test_workflow_invocation_domain.py tests/unit/test_workflow_invocation_store.py tests/unit/test_workflow_delivery_custody.py tests/unit/test_background_outbox.py tests/unit/test_workflow_canonical.py -q`
   then `uv run pytest tests/integration/test_workflow_invocations_api.py tests/integration/test_workflow_invocation_lifecycle_api.py tests/integration/test_workflow_invocation_request_custody.py -q`.
   NOTE: DB schema changed (2 CHECKs) — if the test DB persists between
   runs, drop/recreate or the new constraints won't exist (migration is
   create-table-guarded `_has_table`).
4. Then: `uv run ruff check proliferate tests`, `python ../scripts/check_max_lines.py`,
   `python ../scripts/check_server_boundaries.py`, alembic single-head
   (`uv run alembic heads` → expect only c4d5e6f7a8b1), `git diff --check`.
5. Audit acceptance criteria still open besides tests: none in product code —
   but keep NO abandon Celery handler registered until it re-checks all six
   proof fields (relay leaves workflows.* pending by design; F rework is a
   SEPARATE remaining item, see board above).
6. Board items untouched this session: A (PG numeric round-trip matrix
   gaps), B (nested setupConfig + fixture/digest re-pin in 3 languages),
   F (relay exclude-list rework), J (owner-scoped workspace lookup), K
   (rollback/outbox + relay-starvation races beyond the batch above),
   canonical module location ruling (currently proliferate/utils/
   canonical_json.py — staged rename; boundary check passed earlier, but
   ownership ruling still pending), OpenAPI/cloud SDK regen check, final
   adversarial review, single atomic commit.

### First commands for the fresh session

```
cd server
uv run python -c "import proliferate.server.workflows.service"   # sanity
rg -n "invocation_store\.(mark_delivery|fix_runtime|record_delivery|update_runtime|record_runtime)" tests/
uv run pytest tests/unit/test_workflow_invocation_store.py -x -q  # drive repairs failure-first
```
