# Delivery specification — testing-cicd: test races + the lock debt (frozen)

Chain position: first follow-up slice after the 2026-08-26/27 testing/linting/ci-cd train (staging pipeline → e2e observable → gate & hooks → lint wiring → lane census → **test races + lock debt**). Evidence of record: **the lock map** (`Vault/Testing Linting CICD/60 Lock Map.md`, enumerated 2026-08-27 on main @ 63f3f0f3e) — all 123 `await_holding_lock` sites are test code reached through one test-support mutex plus one lexical false positive, zero production sites; and its incident analysis — the two flaky tests of 2026-08-27 are fixture/teardown races, not lock bugs. Founder authorization of record: *"for the tests then I trust you to fix"* (2026-08-27). Builders implement from this document without re-deriving the diagnosis.

## Intent

Retire the `await_holding_lock` debt at its single root (the test-support environment mutex becomes async-aware) and flip the lint from tracked-allow to law; fix the two flaky tests at their diagnosed causes so they become the deterministic pinning proof the postmortem law demands (`specs/engineering/testing/README.md` § Laws — the postmortem rule).

## Acceptance gate (the merge bar)

The two formerly-flaky tests — `stop_and_await_kill_escalation_can_leave_the_agents_own_output_torn_mid_record` and `concurrent_double_fork_on_the_same_key_never_duplicates_the_child` — pass **50 consecutive runs each** (counts in the PR body), and the audit invocation
`cargo clippy --workspace --all-targets --keep-going -- -A warnings --force-warn clippy::await_holding_lock`
reports **exactly 0 findings** (note: plain `-W` silently under-counts to zero on rustc 1.98 — `--force-warn` is the only honest audit). **Falsifier:** any flake within the 50, or any remaining site, or the lint still `allow`ed in the root `Cargo.toml`.

## Scope

Rulings of record: the lock map's fix-pattern menu (2026-08-27); the ruled clippy allow-list of 2026-08-26, from which `await_holding_lock` now exits via fix rather than allow.

- **`anyharness-lib/src/app/test_support.rs`** — `ENV_MUTEX` becomes `tokio::sync::Mutex<()>`; `lock_env()` becomes `async fn` returning the async guard. Holding across awaits is then the *intended, lint-clean* semantics; serialization under `cargo test` is preserved (waiters yield instead of blocking threads); nextest (process-per-test) stays uncontended by construction; the poisoning cascade documented in the map disappears (tokio mutexes do not poison) — the doc comment is rewritten to say all of this.
- **Call-site sweep** — every `lock_env()` caller gains `.await`; every direct `ENV_MUTEX.get_or_init(...).lock().expect(...)` boilerplate block collapses to `test_support::lock_env().await`; guard-wrapping helpers (`checkpoints/test_support.rs::EnvGuard::{on,off}`, `readiness/test_env_guards.rs` re-export, `make_app_state`-path users) go async with their guard fields retyped. The module-local `ENV_MUTEX` in `agents/auth/login.rs` (sync tests, no awaits, never flagged) is out of scope and untouched.
- **The false positive** — `domains/agent_operations/mcp/tests.rs:534`: the spy-log read is wrapped in an explicit block so the guard's lexical scope ends before the next await; the `drop(calls)` goes away; **no allow**.
- **The lint flips to law** — `await_holding_lock = "allow"` is removed from `[workspace.lints.clippy]` (root `Cargo.toml`); it rides `-D warnings` in the rust-lint job from then on. `lints/anyharness/native-debt.toml`'s `AH-CLIPPY-1` is retired per the record's own contract ("closing it means fixing the sites and flipping the lint back on"): the record is rewritten to `status = "holds"`, `enforced_by` the rust-lint lane, with the resolution date, this PR, and the corrected framing (the "123 hazards in the runtime" premise was wrong — one test-support pattern, zero production sites). `lints/native-tools.md`'s clippy row notes the flip.
- **`workspace_stop` fixture race** — the dummy-agent script installs `trap '' TERM` **before** writing any record, so the readiness marker the test polls for can only appear TERM-immune; the torn third record stays exactly as designed (the tear is file-content state, not timing). Two-line reorder in `live/sessions/actor/tests/workspace_stop.rs`.
- **`fork_dispatch` teardown race** — the `remove_dir_all(&runtime_home)` teardown races writers still draining after `close_all` (the diagnosed `DirectoryNotEmpty`). All **six** identical teardown sites in `fork_dispatch_and_restart_tests.rs` (lines 168, 302, 363, 435, 503, 578 pre-change) move to one shared bounded-retry helper that names the race in its comment and still panics loudly after the bound — the error is never swallowed.
- **Paper trail** — issue #2276 commented with the lock-map reframe and closed by this PR; the `KNOWN GAP` comment in `lints/product/lanes.toml` updated: the two named per-test quarantine candidates are fixed at root (the per-test-schema gap note itself stays open); any `max_lines` ratchet the edits touch is re-measured with a reason.

## Non-goals (deliberately out)

**The terminals quiesce/cancellation-atomicity bug** (the 6-hour hang; the one real production finding of the lock map) — explicitly fenced to a joint founder session; nothing in `live/terminals/**` production code is touched here · any production concurrency change anywhere (this slice edits test code, test support, and lint configuration only) · re-sorting or re-homing tests · the Biome slice (deferred by founder ruling until the open review queue drains).

## Proof

- The two fixed tests ARE the pinning proof (postmortem rule): deterministic under 50 consecutive runs, counts recorded in the PR body.
- The audit invocation above at exactly 0 findings, quoted in the PR body.
- `cargo nextest run --workspace` green; repo-shape engines + `test_gate` green (the gate's clippy step inherits the flipped lint automatically via the workspace config).
