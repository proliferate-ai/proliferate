# Proliferate

Proliferate contains the Desktop, Web, and Mobile clients; the hosted control
plane; and the AnyHarness runtime used to run coding-agent sessions.

- Repository: <https://github.com/proliferate-ai/proliferate>
- Documentation entrypoint: [`specs/README.md`](specs/README.md)

## Before Editing

Canonical current documentation describes operating truth and enforced
architecture. Other documentation lifecycles are defined in `specs/README.md`.
A frozen delivery specification describes the intended delta for one PR. Read
the applicable artifacts before editing, and report a concrete contradiction
instead of silently changing the frozen scope.

Start with `specs/README.md`, then follow the source-area router below. The
focused area document wins if this file overlaps with it.

## Build And Develop

Runtime baseline: Rust stable, Node 22+, pnpm, Python 3.12, and `uv`.

```bash
cargo build
cargo run --bin anyharness -- serve

(cd anyharness/sdk && pnpm install && pnpm run generate && pnpm run build)
(cd server && uv run pytest -q)
```

Use an isolated profile for full-stack local work, especially across
worktrees:

```bash
make setup PROFILE=<name>
make build
make run PROFILE=<name>
make dev-list
```

Profile state lives under `~/.proliferate-local/dev/profiles/<name>/`; runtime
state lives under `~/.proliferate-local/runtimes/<name>/`. Read
[`specs/developing/local/README.md`](specs/developing/local/README.md) before
running a feature worktree or changing local launch behavior.

## Source Router

Use the most specific matching row. When a change crosses areas, read every
applicable owner.

| Source area | Start here |
| --- | --- |
| `AGENTS.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md` | [`specs/developing/process/README.md`](specs/developing/process/README.md) |
| `apps/desktop/**`, `apps/web/**`, `apps/mobile/**`, `apps/packages/**` | [`specs/codebase/structures/frontend/README.md`](specs/codebase/structures/frontend/README.md) |
| `apps/desktop/src-tauri/**`, `apps/desktop/src-tauri-debug/**` | [`specs/codebase/structures/desktop-native/README.md`](specs/codebase/structures/desktop-native/README.md) |
| `server/**` | [`specs/codebase/structures/server/README.md`](specs/codebase/structures/server/README.md) |
| `cloud/sdk/**`, `cloud/sdk-react/**`, `anyharness/sdk/**`, `anyharness/sdk-react/**` | [`specs/codebase/structures/sdk/README.md`](specs/codebase/structures/sdk/README.md) |
| `anyharness/crates/anyharness*/**` | [`specs/codebase/structures/anyharness/README.md`](specs/codebase/structures/anyharness/README.md) |
| `anyharness/crates/proliferate-worker/**` | [`specs/codebase/structures/proliferate-worker/README.md`](specs/codebase/structures/proliferate-worker/README.md) |
| `anyharness/crates/proliferate-supervisor/**`, `install/**` | [`specs/codebase/structures/proliferate-supervisor/README.md`](specs/codebase/structures/proliferate-supervisor/README.md) |
| `tests/intent/**`, `tests/release/**`, `anyharness/tests/**`, `fixtures/contracts/**` | [`specs/developing/testing/README.md`](specs/developing/testing/README.md) |
| `scripts/agent-gateway-smoke/**` | [`specs/developing/testing/README.md`](specs/developing/testing/README.md) |
| `catalogs/**`, `scripts/agent-catalog/**` | [`specs/codebase/platforms/product/README.md`](specs/codebase/platforms/product/README.md) |
| `.github/workflows/**`, `scripts/ci-cd/**`, `apps/desktop/infra/**`, `apps/desktop/scripts/**`, `server/infra/**`, `server/deploy/**` | [`specs/developing/deploying/README.md`](specs/developing/deploying/README.md) |
| `.auth-env/**`, local profiles, local app identity | [`specs/developing/local/README.md`](specs/developing/local/README.md) |

After the structure document, use
[`specs/codebase/README.md`](specs/codebase/README.md) to find the reusable
platform contract or complete product/system contract involved in the change.
Use [`specs/developing/README.md`](specs/developing/README.md) for procedures.

## Repository-Wide Rules

- Preserve current behavior unless the frozen specification changes it.
- Prefer ownership-correct changes over cosmetic churn.
- Do not leave duplicate old and new paths after a migration.
- Use direct imports; do not add convenience barrel or re-export modules.
- Respect generated-code boundaries and regenerate through the owning tool.
- Delete dead code when replacing an implementation.
- Keep the repository buildable and run the narrowest proof that establishes
  the requested behavior.
- Do not use destructive Git commands such as `git reset --hard` or
  `git checkout --` unless the user explicitly requests them.
- Record unrelated defects as follow-ups instead of expanding the current PR.

Run `python3 scripts/check_docs.py` after changing repository documentation.

Prepare and mark pull requests ready according to
[`specs/developing/process/pull-requests.md`](specs/developing/process/pull-requests.md).
