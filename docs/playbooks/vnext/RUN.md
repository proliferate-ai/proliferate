# Run: vNext Architecture Refactor (6 Sequential Agents)

These are **sequential** — each phase must merge before the next begins. Paste each prompt into a fresh Claude Code session after the previous PR merges.

---

## Phase 0: Database & Core Interfaces

```
Create a git worktree from `chore/agent-playbooks`:
  git worktree add -b vnext/phase-0-database-types .worktrees/vnext-p0 chore/agent-playbooks

Read `docs/playbooks/vnext/00-phase-database-and-types.md` from the worktree for your full instructions. Read all relevant vNext specs in `docs/specs/vnext/`. Implement everything autonomously. Run `pnpm typecheck && pnpm lint` from the worktree. Commit (no Co-Authored-By), push, and open a PR against `main` with `gh pr create`.
```

---

## Phase 1: Triggers Ingestion

```
Create a git worktree from `main` (Phase 0 must be merged):
  git worktree add -b vnext/phase-1-triggers .worktrees/vnext-p1 main

Read `docs/playbooks/vnext/01-phase-triggers-ingestion.md` from the worktree for your full instructions. Read the old and vNext triggers specs. Implement everything autonomously. Run `pnpm typecheck && pnpm lint` from the worktree. Commit (no Co-Authored-By), push, and open a PR against `main` with `gh pr create`.
```

---

## Phase 2: Actions & Integrations

```
Create a git worktree from `main` (Phase 1 must be merged):
  git worktree add -b vnext/phase-2-actions-integrations .worktrees/vnext-p2 main

Read `docs/playbooks/vnext/02-phase-actions-and-integrations.md` from the worktree for your full instructions. Read the old and vNext actions and integrations specs. Implement everything autonomously. Run `pnpm typecheck && pnpm lint` from the worktree. Commit (no Co-Authored-By), push, and open a PR against `main` with `gh pr create`.
```

---

## Phase 3: Gateway & Agent Boundary

```
Create a git worktree from `main` (Phase 2 must be merged):
  git worktree add -b vnext/phase-3-gateway-agent .worktrees/vnext-p3 main

Read `docs/playbooks/vnext/03-phase-gateway-and-agent.md` from the worktree for your full instructions. Read the old and vNext specs for sessions-gateway, agent-contract, and sandbox-providers. Implement everything autonomously. Run `pnpm typecheck && pnpm lint` from the worktree. Commit (no Co-Authored-By), push, and open a PR against `main` with `gh pr create`.
```

---

## Phase 4: Convergence & Cleanup

```
Create a git worktree from `main` (Phase 3 must be merged):
  git worktree add -b vnext/phase-4-convergence .worktrees/vnext-p4 main

Read `docs/playbooks/vnext/04-phase-convergence.md` from the worktree for your full instructions. Systematically resolve all TypeScript compiler errors. Delete legacy files. Run `pnpm typecheck && pnpm lint` from the worktree. Commit (no Co-Authored-By), push, and open a PR against `main` with `gh pr create`.
```

---

## Phase 5: Frontend UI & Information Architecture

```
Create a git worktree from `main` (Phase 4 must be merged):
  git worktree add -b vnext/phase-5-frontend-ui .worktrees/vnext-p5 main

Read `docs/playbooks/vnext/05-phase-frontend-ui.md` from the worktree for your full instructions. Redesign the frontend IA to match the vNext backend. Run `pnpm typecheck && pnpm lint` from the worktree. Commit (no Co-Authored-By), push, and open a PR against `main` with `gh pr create`.
```
