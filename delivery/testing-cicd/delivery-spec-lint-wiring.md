# Delivery specification — testing-cicd: lint wiring (frozen)

Chain position: fourth implementation slice of the 2026-08-26 testing/linting/ci-cd alignment (staging pipeline → e2e observable → gate & hooks → **lint wiring** → lane census → nightly). Evidence of record: the 2026-08-26 lint rulings ("the estate is two halves — buy and build"; clippy: mechanical fixes now, judgment lints allow-as-data provisional, `await_holding_lock` = tracked debt row + careful queued pass, then `-D warnings` + rustfmt into CI; ruff over `scripts/` + `server/scripts/`; the 8 `gaps.toml` do-nothing records deleted; `check_component_library` gets its record) and the same-day inventory (clippy 819 warnings — ~270 `result_large_err`, 123 `await_holding_lock`, ~45 too-many-arguments, ~360 mechanical; rustfmt already clean; repo `scripts/` the last unlinted Python). The testing system spec landing tonight carries the prose: this slice implements target sections `specs/engineering/testing/lints.md` § "Buy vs build" and § "The six families" (families 1 and 5). Builders implement from this document without re-deriving the architecture.

## Intent

The Rust plane gets the same mechanical enforcement every other plane already has — formatting and bug-pattern linting gating every PR — and the lint constitution sheds its dead weight: records that enforce nothing are deleted, the one checker outside rules-as-data gets its records, and the last unlinted Python in the repository (the checker engines themselves) comes under ruff.

## Acceptance gate (the merge bar — performed by Pablo or a directed agent)

Open a scratch PR containing one unformatted `.rs` file and one `let x = y.clone();` where the clone is useless: the `rust-lint` job goes **red naming the lint** (`rustfmt` diff / `clippy::redundant_clone`), and `ci-ok` fails with it. Falsifier: that PR shows `rust-lint` green · `rust-lint` absent from `ci-ok`'s `needs:` (the drift guard must make that impossible) · `cargo nextest run --workspace` red on main after the mechanical fixes.

## Scope

Rulings of record: vault `20 Lints.md` decisions block, all marked RULED 2026-08-26.

- **Clippy mechanical fixes** — `cargo clippy --fix` across the workspace plus hand-fixes for the residue; behavior-preserving only; `cargo nextest run --workspace` green after.
- **`[workspace.lints.clippy]`** in the root `Cargo.toml` + `[lints] workspace = true` in every member crate: `result_large_err`, `too_many_arguments`, `type_complexity`, `large_enum_variant` on `allow` with a comment marking them **provisional — re-ruled during the code-debt migration**; `await_holding_lock` on `allow` with a **tracked debt record** (`lints/anyharness/native-debt.toml`, citing a filed tracking issue: 123 sites, careful lock-scope pass queued — real hazards, suppressed deliberately, never silently).
- **`rust-lint` CI job** in `ci.yml`: `cargo fmt --check` + `cargo clippy --workspace --all-targets -- -D warnings`, added to the `ci-ok` rollup `needs:` (the drift guard enforces membership).
- **Ruff over the engines**: root `ruff.toml` covering repo `scripts/` (pinned to the server's ruff version), violations fixed; `server-ci`'s ruff steps extended to include `server/scripts/`; a repo-shape step runs check + `format --check` over `scripts/`.
- **`lints/server/gaps.toml` deleted** — all 8 records are `enforced_by = "review"` (they enforce nothing). This is a constitutional amendment **pre-approved by founder ruling 2026-08-26** ("honest beats aspirational; re-author properly if a law earns an engine"); the rule sentences remain recoverable from git history.
- **`check_component_library` records** — `PROD-COMPLIB-*` `[[rule]]` records in `lints/product/component-library.toml`, one per mechanical check, `enforced_by` the existing script; the script's diagnostics gain the citable id. Its shrink-only ledger remains `scripts/component_library_allowlist.json` (same pattern as the appearance census).
- **`lints/native-tools.md`** updated: clippy + rustfmt wired (dated), ruff scope widened, Biome pending its own slice.

## Non-goals (deliberately out)

The Biome repo-wide format commit (config/scripts may exist elsewhere; the format itself waits for the coordinator's explicit train-end signal) · any `await_holding_lock` fix (debt row only; the careful pass is its own scheduled work) · mypy scope changes · `make gate` (its own slice; the gate consumes this slice's allow-list once landed) · the lane census (own slice).

## Proof

- `rust-lint` job green on main; red on the acceptance-gate scratch branch, naming the lint.
- `cargo nextest run --workspace` green at the head of the slice.
- `python3 scripts/lint_records.py` + `python3 -m unittest scripts/test_lint_records.py scripts/test_check_component_library.py` green with the new records and without `gaps.toml`.
- Ruff check + format-check green over `scripts/` and `server/scripts/` in their CI lanes.
- `node --test scripts/ci-cd/*.test.mjs` green (rollup drift guard sees the new job).

## Discharges

Lint-family gaps 1 (rustfmt not gating; `scripts/` uncovered) and 5 (clippy unwired) from the six-families table; family-6 outlaw (`check_component_library` recordless); the 8-record dead weight. Remaining in the family table after this slice: Biome (own slice) and the queued new lints (proof trailers, lane census, etc. — own slices).
