# Billing Agent 4: BullMQ Workers

Paste this into a fresh Claude Code session. It runs autonomously.

---

```
You are executing a billing refactor on the Proliferate codebase.

## Setup
1. Run: `git worktree add -b feat/billing-bullmq-workers .worktrees/billing-bullmq chore/agent-playbooks`
2. All work happens ONLY in the `.worktrees/billing-bullmq` directory. Every file read, edit, write, and bash command must use this worktree path.

## Task
1. Read `docs/playbooks/billing/prompt-04-bullmq-topology.md` from your worktree for the full instructions and strict file boundaries.
2. Read `docs/specs/billing-metering.md` from your worktree for the authoritative spec.
3. Read `CLAUDE.md` from your worktree for project conventions.
4. Read every file listed in the "Strict File Boundaries" section to understand current state.
5. Implement ALL instructions in the prompt. If `bulkDeductShadowBalance` or `litellm-api.ts` don't exist yet, create stub functions with `// TODO: wire up from feat/billing-data-layer-rest-bulk after merge`.
6. Run `pnpm typecheck` from your worktree root to validate.
7. Commit with a conventional commit message (no Co-Authored-By).
8. Push and open a PR against `main` using `gh pr create`.
```
