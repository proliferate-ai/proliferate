# README Asset Shot List

Captures needed for the README feature wall. For each: record a GIF (8–12s,
tight loop, 2x speed where it helps) **and** export a JPG still (first clean
frame) as the `<picture>` fallback. Keep every GIF well under 10 MB; GitHub
truncates large files and mobile readers pay for every byte. Trim chrome:
crop to the app window, hide personal info, use a demo repo.

Feature-wall files live in `specs/developing/assets/readme/feature-wall/`.

| File | What to record |
| --- | --- |
| `hero.{gif,png}` | Composite hero: desktop app running 3–4 agents in parallel worktrees, transcript streaming in one pane; keep the existing `hero.png` composition as the still. |
| `feature-wall/session-handoff.{gif,jpg}` | The differentiator. A running local session → "move to cloud" action → same conversation continuing in the cloud sandbox (badge/indicator visibly flips). If reverse direction is quicker to stage, capture cloud → local instead. |
| `feature-wall/parallel-agents.{gif,jpg}` | One prompt fanned across 2–3 agents (Claude Code + Codex + OpenCode), each in its own worktree; sidebar shows them running concurrently; end on the comparison view. |
| `feature-wall/agent-delegation.{gif,jpg}` | Codex (or Claude) spawning a subagent / handing work to another harness; show the delegation appearing in the transcript and the child session running. |
| `feature-wall/review.{gif,jpg}` | Diff review pane: scroll a multi-file agent diff, edit a hunk inline, show a reviewer-agent verdict/annotation. |
| `feature-wall/automations-slack.{gif,jpg}` | A Slack message turning into an agent session (or a scheduled automation firing), then the result opening in the app. Playground live-stream fixture can stand in for the transcript if staging Slack is slow. |
| `feature-wall/self-host.{gif,jpg}` | Terminal: `./bootstrap.sh` output ending in a healthy `curl /health`, then the desktop connect dialog pointing at `https://proliferate.yourco.com`. Split-screen terminal+app reads best. |

Capture tricks: the design-system sandbox screenshot flow and the playground
live-stream fixture (`/playground`) both give controlled, reproducible app
states without staging real work.
