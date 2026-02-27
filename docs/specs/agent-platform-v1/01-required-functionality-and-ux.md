# Required Functionality End to End (Including UX)

## Goal
Ship a usable V1 where teams can:
- Run one-off coding tasks
- Run persistent background engineering agents
- Review outputs and approve risky actions
- Track work in a reliable org dashboard

## User-visible features (must-have)

### A) Interactive coding run
User flow:
1. User opens web app (or Slack/GitHub entry point)
2. User asks for a task (for example: "fix this failing test")
3. Session starts in E2B sandbox
4. Agent edits code, runs checks, produces result
5. User sees PR link, summary, logs/artifacts

Acceptance:
- User can start run in under 1 minute
- Session page shows live progress and persisted history
- Final output includes at least summary + PR link or failure reason
- Final output includes a visual artifact (screenshot or short recording) showing app behavior or test UI state when relevant

### B) Persistent background agent
User flow:
1. User creates agent (for example: "Sentry Auto-Fixer")
2. User connects sources (Sentry + GitHub + Slack)
3. Agent wakes from cron/webhooks, triages, spawns child runs
4. User asks: "what got fixed today?"
5. Agent replies with links to runs/PRs and pending approvals

Acceptance:
- Agent can wake repeatedly without manual restart
- Child runs are tracked with clear status
- User can pause/resume/cancel the persistent agent

### C) Approval workflow
User flow:
1. Agent requests risky action
2. System marks invocation pending approval
3. Approver approves or denies from UI
4. Agent receives decision and continues/halts

Acceptance:
- Approval list is DB-driven (works even if no live stream)
- Every approval/deny has audit row with actor and timestamp

### D) Org dashboard reliability model
The dashboard should:
- Read durable rows first (sessions, invocations, runs)
- Attach to live stream only when user opens detail view

Acceptance:
- Org list pages are usable with stream disconnected
- Session detail page shows both persisted and live updates

## Key UX surfaces

### 1) Mission Control (org-level)
Shows:
- Active background agents
- Running/failed/pending runs
- Approval queue
- Quick links to child runs and PRs

### 2) Agent detail page
Shows:
- Agent config and status
- Last wake time
- Current objective
- Recent outputs and run history

### 3) Session detail page
Shows:
- Live stream (terminal/events)
- Persisted timeline
- Tool/action outputs
- Git state + artifact links

### 4) Approval inbox
Shows:
- Pending action invocations
- Why action was requested
- Approve/deny controls
- Audit trail after decision

## Data model requirements (plain language)
Minimum durable records:
- Agent
- Session
- Run (if distinct from session in V1 implementation)
- Action invocation
- Trigger event
- Inbox event

Plus key links:
- Session belongs to agent
- Invocation belongs to session
- Trigger event can create run/session

Additional immutable runtime record:
- `boot_snapshot` on each session/run, capturing prompt, model, tool grants, and execution identity at start time

Why:
- Running work must not change behavior because someone edits live agent config mid-run
- Audit/replay must reflect what the agent was actually allowed to do at that moment

## Non-goals (for V1)
- General-purpose no-code workflow editor
- Broad non-engineering automation catalog
- Perfect autonomous merge/deploy with zero approvals

## Definition of done checklist
- [ ] Interactive run works from user prompt to reviewable output
- [ ] Persistent agent wakes repeatedly and can spawn child runs
- [ ] Approval queue gates risky actions
- [ ] Org dashboard is DB-first and resilient
- [ ] Session detail combines live stream + persisted outputs
- [ ] Session/run stores immutable `boot_snapshot` at creation time
- [ ] Coding runs publish visual proof artifact in final output bundle
