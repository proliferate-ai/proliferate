# Delivery specification — testing-cicd: make gate + hooks (frozen)

Chain position: third implementation slice of the 2026-08-26 testing/linting/ci-cd alignment (staging pipeline → e2e observable → **gate & hooks** → lint wiring → lane census → nightly). Evidence of record: the ruled pre-push and commit pipeline blocks of 2026-08-26 ("format-on-commit · gate-on-push · CI as backstop"; the mirror rule; fleet-first economics — the committers are agents). The ci-cd system spec landing tonight carries the prose: this slice implements target sections `specs/engineering/ci-cd/pipelines.md` § "Pipeline — pre-push" and § "Pipeline — commit". Builders implement from this document without re-deriving the architecture.

## Intent

One command — `make gate` — runs, change-scoped, the same checks CI will run, in ≤ 2 minutes warm, so a push that passes the gate does not embarrass its author six minutes later. A sub-second format-only pre-commit makes "unformatted code" a state that cannot exist in history. Both hooks install through the existing `make setup` path (`core.hooksPath` is repo-shared, so one setup covers every agent worktree). The gate's primary consumers are fleet agents: auto-fix beats block, failure output is machine-legible (name · verdict · exact re-run command), and bypass is designed against — CI stays the authority, so skipping the gate is wasteful, never fatal.

## Acceptance gate (the merge bar — performed by Pablo, locally)

Touch one file under `server/proliferate/`, run `make gate`: only the server checks plus the always-set run, the whole run finishes in under 2 minutes warm, and every command it prints is the same string the corresponding CI step runs. Falsifier: the gate is green but the same push goes red in CI on a check the gate claimed to have run · the gate runs frontend or Rust checks for a server-only diff · a formatter failure blocks a commit (the commit hook may warn, never fail). Secondary check: with local Postgres/Redis stopped, the server-test step reports a loud, unmissable skip naming what was not run — and exits green.

## Scope

Rulings of record: the pre-push/commit pipeline blocks + the hook story (2026-08-26); the mirror rule; "unit purity fiction dropped" (service-needing tests skip loudly, CI authoritative).

- **`scripts/gate`** (new, Python 3 stdlib, executable) — change-scoped by `git diff --name-only` against `merge-base(HEAD, origin/main)` plus staged and unstaged changes; when `origin/main` is unresolvable it warns and runs the always-set only. Composition:
  - *always* → the repo-shape checker **engines** exactly as `ci.yml` § "Repo shape checks" invokes them (`python3 scripts/lint_records.py`, `check_max_lines`, `check_migration_heads`, `check_anyharness_old_paths`, `check_server_old_paths`, `check_proliferate_worker_structure`, `check_frontend_boundaries`, `check_appearance_scaling`, `check_design_attribution`, `check_toast_copy`, `check_agent_auth_secret_logs`, `report_frontend_structure --strict --summary-only`, `check_transcript_scroll_writer`, `check_component_library`, `check_server_boundaries`, `check_anyharness_boundaries`, `check_anyharness_fences`, `check_frontend_fences`, `check_manifests`, `check_session_mutation_admission`, `check_update_flow_lints`, `check_docs`). The unittest halves of those CI steps run only when `scripts/**` is touched (they prove the checkers, not the change).
  - *`server/**`* → `uv run --python 3.12 --frozen --extra dev ruff check proliferate/ tests/` · `… ruff format --check proliferate/ tests/` · `… python scripts/check_mypy_baseline.py --compare-ref origin/main` (the local form of the CI ratchet step, whose `--github-event-base` flag is CI-event-specific by design), all cwd `server/` — plus `pytest` of the touched domains' matching `server/tests/{unit,integration}` files at `-n 2`, **skipping loudly when local Postgres (5432) or Redis (6379) is unreachable** — never failing for missing services.
  - *`anyharness/**` (crates) or `Cargo.*`* → `cargo fmt --check` · `cargo clippy -p <touched crates>` in **info mode** (no `-D warnings`: prints the warning count, fails only on compile errors — promoted to `-D` when the lint-wiring slice lands its allow-list) · `cargo nextest run -p <touched crates>`; crate names parsed from each touched crate's `Cargo.toml`; a root `Cargo.toml`/`Cargo.lock` change widens to `--workspace`.
  - *frontend* → `apps/packages/**`, `cloud/sdk**` → `pnpm shared:typecheck`; product-client sources additionally → `pnpm --filter @proliferate/product-client exec vitest related --run <changed files>` (the change-scoped form of the CI suite); `apps/packages/design/**` additionally → the theme re-projection equality sequence (tsc → `generate-theme.mjs` → `check-theme.mjs`) **absorbed verbatim from the retired pre-commit hook** — this check is load-bearing and moves, it does not die; `apps/web/**` → `pnpm web:typecheck`; `apps/desktop/**` → `pnpm --filter proliferate exec tsc --noEmit` (the tsc half of CI's `build`; the vite half is a build, not a check); `apps/mobile/**` → `pnpm --filter @proliferate/mobile typecheck`; `anyharness/sdk{,-react}/**` → that package's `typecheck`.
  - *`specs/**`, `delivery/**`, `guides/**`, any `*.md`* → `python3 scripts/check_docs.py`.
  - Output contract: one line per check — `[gate] <name> … ok (<seconds>s) | FAIL | skipped(<reason>)`; every FAIL prints the exact command to re-run; missing tools (`uv`, `pnpm`, `cargo`) degrade to loud skips; summary line + non-zero exit iff any FAIL. Green on clean `main` is a merge-bar requirement of this slice itself.
- **`Makefile`** — a `gate:` target (`python3 scripts/gate`); the existing `git-hooks:` message updated to name both hooks. `setup` already depends on `git-hooks`; no new wiring needed.
- **`scripts/git-hooks/pre-commit`** (replaced) — format-only, auto-fix + restage, **exit 0 always**: `ruff format` (via the server uv env) on staged `.py` under `server/{proliferate,tests}/`, `cargo fmt --all` when staged `.rs` exist; a commented `# biome: enabled by the format slice` line marks the third formatter's slot; `PROLIFERATE_SKIP_HOOKS=1` escape; header documents the partial-staging caveat (restaging a formatted file stages its unstaged hunks). Its two former checks move: appearance-scaling already runs in the gate's always-set; theme equality moves to the gate's design rule (above).
- **`scripts/git-hooks/pre-push`** (new) — `PROLIFERATE_SKIP_HOOKS=1` escape, then `make gate`; on failure prints "fix it, or verify in CI — never --no-verify".
- **`scripts/test_gate.py`** (new) + one `ci.yml` § "Repo shape checks" step running it — unit tests over the scoping logic: path→plane classification, crate-name derivation, domain→test-file mapping, the services-unreachable skip branch (injected), and the mirror-rule command strings pinned against literals.

## Non-goals (deliberately out)

Biome (adopted, not yet in-repo — the format slice lands it and uncomments the hook line) · clippy `-D warnings` inside the gate (lint-wiring slice's allow-list first) · any change to CI lanes beyond the one unittest step (PR-pipeline density — rust job, hollow vitest suites — is the lint-wiring and census slices') · lane-census `gate_mirrored` rows (census slice; until then the mirror rule is pinned by `test_gate.py`'s command literals) · running the gate itself in CI (CI runs the real thing; the gate is its local mirror).

## Proof

- `python3 -m unittest scripts/test_gate.py` green — classification, crate/domain mapping, skip semantics, pinned command strings.
- `python3 scripts/gate` green on a clean checkout of `main` (run and recorded on the PR).
- A server-only synthetic diff exercises exactly server + always-set (recorded in the PR body); with services stopped, the loud-skip path (recorded).
- Existing suites untouched: full repo-shape checker set green; `ruby` YAML parse of `ci.yml`.

## Discharges

The "pre-push pipeline: doesn't exist" row of the ruled pipeline table; the hook story (format-on-commit · gate-on-push · installed by setup); audit-independent — no staging or CI-lane dependencies, safe to land in any train position.
