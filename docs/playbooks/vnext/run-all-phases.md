# vNext Refactor: All 6 Phases (Single Agent, Sequential)

Paste this into a fresh Claude Code session. One agent executes all 6 phases sequentially, stacking branches.

---

```
You are executing a massive 6-phase vNext architecture refactor on the Proliferate codebase. You will do all 6 phases sequentially, each on its own branch stacked on the previous one. Track your progress in a status file.

## Setup
1. Run: `git worktree add -b vnext/phase-0-database-types .worktrees/vnext chore/agent-playbooks`
2. All work happens ONLY in the `.worktrees/vnext` directory.
3. Create a progress tracker at `.worktrees/vnext/docs/playbooks/vnext/PROGRESS.md` with this initial content:

# vNext Refactor Progress

| Phase | Status | Branch | PR |
|-------|--------|--------|----|
| 0 — Database & Types | pending | | |
| 1 — Triggers Ingestion | pending | | |
| 2 — Actions & Integrations | pending | | |
| 3 — Gateway & Agent | pending | | |
| 4 — Convergence | pending | | |
| 5 — Frontend UI | pending | | |

## Execution Loop

For each phase (0 through 5):

### 1. Read the playbook
Read `docs/playbooks/vnext/<phase-file>.md` from your worktree. Also read all relevant specs referenced in that playbook (both old specs in `docs/specs/` and vNext specs in `docs/specs/vnext/`). Read `CLAUDE.md` for project conventions.

### 2. Implement
Follow every instruction in the playbook. Stay within its file boundaries and guardrails. Do NOT implement logic belonging to a later phase.

### 3. Validate
Run `pnpm typecheck && pnpm lint` from your worktree root.

### 4. Commit & PR
- Commit with a conventional commit message (no Co-Authored-By).
- Push the branch.
- Open a PR using `gh pr create`. For Phase 0, target `main`. For Phases 1-5, target the previous phase's branch (stacked PRs).

### 5. Update progress
Update `PROGRESS.md` — set the phase to `done`, record the branch name and PR URL.

### 6. Branch for next phase
If not the last phase, create the next branch from the current one:
- `git checkout -b vnext/phase-1-triggers` (from phase-0 branch)
- `git checkout -b vnext/phase-2-actions-integrations` (from phase-1 branch)
- `git checkout -b vnext/phase-3-gateway-agent` (from phase-2 branch)
- `git checkout -b vnext/phase-4-convergence` (from phase-3 branch)
- `git checkout -b vnext/phase-5-frontend-ui` (from phase-4 branch)

Then loop back to step 1 for the next phase.

## Phase → File Mapping
- Phase 0: `00-phase-database-and-types.md`
- Phase 1: `01-phase-triggers-ingestion.md`
- Phase 2: `02-phase-actions-and-integrations.md`
- Phase 3: `03-phase-gateway-and-agent.md`
- Phase 4: `04-phase-convergence.md`
- Phase 5: `05-phase-frontend-ui.md`

Begin with Phase 0 now.
```
