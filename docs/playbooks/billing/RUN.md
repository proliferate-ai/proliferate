# Run: Billing Refactor (4 Parallel Agents)

Paste the following into a fresh Claude Code session. It creates 4 worktrees off `chore/agent-playbooks` and runs all 4 billing prompts simultaneously.

---

```
Create 4 git worktrees from the `chore/agent-playbooks` branch and run 4 agents in parallel — one per billing playbook prompt. Each agent works in its own worktree with its own branch, implements the prompt fully autonomously, runs `pnpm typecheck`, commits, pushes, and opens a PR against `main`.

Worktree/branch mapping:
- `.worktrees/billing-gate` → branch `feat/billing-iron-door-and-snapshots` → reads `docs/playbooks/billing/prompt-01-domain-gating.md`
- `.worktrees/llm-lifecycle` → branch `feat/llm-key-lifecycle` → reads `docs/playbooks/billing/prompt-02-llm-lifecycle.md`
- `.worktrees/billing-data-layer` → branch `feat/billing-data-layer-rest-bulk` → reads `docs/playbooks/billing/prompt-03-data-layer.md`
- `.worktrees/billing-bullmq` → branch `feat/billing-bullmq-workers` → reads `docs/playbooks/billing/prompt-04-bullmq-topology.md`

For each agent:
1. Create the worktree: `git worktree add -b <branch> .worktrees/<name> chore/agent-playbooks`
2. Spawn a background general-purpose agent in bypassPermissions mode.
3. The agent's prompt must: read its playbook prompt file AND the relevant spec (billing-metering.md or llm-proxy.md) from within its own worktree, implement everything, run `pnpm typecheck` from the worktree root, commit (no Co-Authored-By), push, and `gh pr create` against main.
4. Inline the full playbook content in the agent prompt so it doesn't depend on file reads succeeding.

Launch all 4 agents simultaneously. Report back when all 4 PRs are created.
```
