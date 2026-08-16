# Native-tool enforcement ledger

The TOML records under `lints/` cover the bespoke checkers in `scripts/` —
rules this repository invented and enforces itself. A second class of rules is
enforced by native toolchains in their own config formats. Those rules are
real constitution too, but v1 leaves them where their tools expect them and
records the inventory here so nothing is invisible.

Follow-up scope (not v1): decide per tool whether its config gains a pointer
record in `lints/<owner>/` (a `[[rule]]` with `mode = "compiler"` citing the
native config) or stays ledger-only.

| Tool | Owner | Config | CI wiring | What it enforces |
| --- | --- | --- | --- | --- |
| Clippy | anyharness | workspace defaults (no `clippy.toml`) | none — local only: `make clippy` → `cargo clippy --workspace -- -D warnings` | Rust idiom + correctness lints, warnings are errors |
| rustfmt | anyharness | workspace defaults | none — local only: `make fmt` | Rust formatting |
| tsc (`--noEmit` via `typecheck` scripts) | frontend | per-package `tsconfig.json` | ci.yml typecheck jobs (desktop, web, mobile, shared, tests/release) | TypeScript type soundness per package |
| Ruff (check + format) | server | `server/pyproject.toml` `[tool.ruff]` | server-ci.yml "Ruff check" / "Ruff format check" | Python lint + formatting for `server/` |
| mypy | server | `server/pyproject.toml` `[tool.mypy]` + `server/scripts/check_mypy_baseline.py` | server-ci.yml "Mypy diagnostic ratchet" | Python typing; shrink-only diagnostic-count ratchet against `mypy_baseline.json` |
| Terraform fmt/validate/test | server (infra) | `server/infra/**` | ci.yml Terraform jobs | Infra formatting, validity, policy tests |

Notes:

- Clippy and rustfmt are wired only through the Makefile — no CI job runs
  them today (ci.yml's cargo job runs `cargo check` / `cargo test` only).
  Closing that gap is part of the follow-up scope.
- There is no ESLint in this repository; TypeScript linting is tsc-only.

- The mypy ratchet is the pattern `ratchets.toml` generalizes; migrating it
  into `lints/server/ratchets.toml` is deliberately out of v1 scope because
  its baseline is a mypy-owned JSON artifact updated by a server-CI-specific
  flow.
- Anything a native tool suppresses inline (`#[allow(...)]`,
  `# type: ignore`, `// @ts-expect-error`, per-file-ignores in ruff config)
  is that tool's exception mechanism; the `lints/` exception ledger does not
  duplicate it.
