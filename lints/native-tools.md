# Native-tool enforcement ledger

The TOML records under `lints/` cover the bespoke checkers in `scripts/` —
rules this repository invented and enforces itself. A second class of rules is
enforced by native toolchains in their own config formats: **bought** tools for
everything language-generic, where the records are **built** only for laws no
off-the-shelf tool can know (ruled 2026-08-26 — buy for generic, build for ours;
never a custom formatter, always the boundary checker). Native rules are real
constitution too; they stay in the config their tool expects, and this ledger
keeps the inventory so nothing is invisible.

| Tool | Owner | Config | CI wiring | What it enforces |
| --- | --- | --- | --- | --- |
| Clippy | anyharness | root `Cargo.toml` `[workspace.lints.clippy]` (every member crate: `[lints] workspace = true`) | ci.yml `rust-lint` — `cargo clippy --workspace --all-targets -- -D warnings` (since 2026-08-27) | Rust idiom + correctness lints, warnings are errors. The allow-list is the constitution: four judgment lints (`result_large_err`, `too_many_arguments`, `type_complexity`, `large_enum_variant`) allowed **provisionally**, re-ruled at the code-debt migration; `await_holding_lock` is **deny** (law since 2026-08-27: the debt was one test-support mutex, fixed by the tokio swap — retired record `lints/anyharness/native-debt.toml` AH-CLIPPY-1) |
| rustfmt | anyharness | workspace defaults, toolchain pinned by `rust-toolchain.toml` (bump deliberately, with the reformat the bump implies) | ci.yml `rust-lint` — `cargo fmt --all --check` (since 2026-08-27; tree normalized under 1.98.0 in the same PR) | Rust formatting |
| tsc (`--noEmit` via `typecheck` scripts) | frontend | per-package `tsconfig.json` | ci.yml typecheck jobs (desktop, web, mobile, shared, tests/release) | TypeScript type soundness per package |
| Ruff (check + format) | server | `server/pyproject.toml` `[tool.ruff]` | server-ci.yml "Ruff check" / "Ruff format check" over `proliferate/ tests/ scripts/` (scope widened 2026-08-27) | Python lint + formatting for `server/` |
| Ruff (check + format) | product (the engines) | `scripts/ruff.toml` — mirrors the server config minus `ANN` | ci.yml `repo-shape` "Ruff over the checker engines" — `uvx ruff@0.16.2` (since 2026-08-27; pin in lockstep with `server/uv.lock`) | Python lint + formatting for the checker engines and repo tooling under `scripts/` |
| mypy | server | `server/pyproject.toml` `[tool.mypy]` + `server/scripts/check_mypy_baseline.py` | server-ci.yml "Mypy diagnostic ratchet" | Python typing; shrink-only diagnostic-count ratchet against `mypy_baseline.json` |
| Terraform fmt/validate/test | server (infra) | `server/infra/**` | ci.yml Terraform jobs | Infra formatting, validity, policy tests |
| Biome (format only) | frontend | — | — | **Pending its own slice** (ruled 2026-08-26): TS/CSS/JSON formatting; lint stays tsc-only. Lands with the repo-wide format commit + `.git-blame-ignore-revs` at the coordinator's signal |

Notes:

- There is no ESLint in this repository; TypeScript linting is tsc-only.
- The mypy ratchet is the pattern `ratchets.toml` generalizes; migrating it
  into `lints/server/ratchets.toml` is deliberately out of scope because its
  baseline is a mypy-owned JSON artifact updated by a server-CI-specific flow.
- Anything a native tool suppresses inline (`#[allow(...)]`,
  `# type: ignore`, `// @ts-expect-error`, per-file-ignores in ruff config)
  is that tool's exception mechanism; the `lints/` exception ledger does not
  duplicate it. A **workspace-level** suppression of a real hazard is the one
  exception to that rule: it gets a debt record (`native-debt.toml`) so the
  suppression is visible constitution, never a silent config line.
