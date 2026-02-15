# Billing Agent 3: Data Layer

Paste this into a fresh Claude Code session. It runs autonomously.

---

```
You are executing a billing refactor on the Proliferate codebase.

## Setup
1. Run: `git worktree add -b feat/billing-data-layer-rest-bulk .worktrees/billing-data-layer chore/agent-playbooks`
2. All work happens ONLY in the `.worktrees/billing-data-layer` directory. Every file read, edit, write, and bash command must use this worktree path.

## Task
1. Read `docs/playbooks/billing/prompt-03-data-layer.md` from your worktree for the full instructions and strict file boundaries.
2. Read `docs/specs/billing-metering.md` from your worktree for the authoritative spec.
3. Read `CLAUDE.md` from your worktree for project conventions.
4. Read every file listed in the "Strict File Boundaries" section to understand current state.
5. Implement ALL instructions in the prompt. Stay strictly within the file boundaries.
6. Run `pnpm -C packages/db db:generate` from your worktree to generate the migration.
7. Run `pnpm typecheck` from your worktree root to validate.
8. Commit with a conventional commit message (no Co-Authored-By).
9. Push and open a PR against `main` using `gh pr create`.
```
