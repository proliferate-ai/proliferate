# Required Functionality End to End (Including UX)

## Goal
Ship a product where users can rely on Proliferate as a real coworker:
- Long-running coworkers that keep working in the background
- High-quality coding sessions with strong runtime visibility
- Broad integrations (org-wide and personal) with safe action execution
- Clean onboarding that gets teams productive fast

This spec is the practical bar for V1 plus near-term parity direction (Cursor/Lovable/Claude cowork-style behavior).

## Product bar (plain language)
Users should feel:
- "I can ask this coworker to do real work, not just chat."
- "I can check status from anywhere, especially the web dashboard."
- "I can safely connect tools and know who is acting with which credentials."
- "Coding runs are transparent: I can see terminal, changes, preview, and outcomes."

## Must-have workflows (end to end)

### A) Clean setup and onboarding
User flow:
1. Connect GitHub
2. Pick repo
3. Paste `.env.local` (development env) or select existing env bundle
4. Run setup/onboarding job that prepares workspace and snapshot
5. Connect tools/integrations needed for this coworker
6. Set communication preferences
7. Start first task

Acceptance:
- Setup is guided and understandable by non-platform engineers
- First useful run starts without manual infra steps
- Onboarding produces a reusable baseline snapshot/config for follow-up runs
- Docs include a one-liner start path and clear troubleshooting
- Development env values are stored as encrypted env bundles; `boot_snapshot` stores env references only
- Action/integration secrets are managed separately from `.env.local` bundles

### B) Create a coworker in chat-first style
User flow:
1. User opens "Create coworker"
2. Describes goal in plain English (for example "watch Sentry and fix regressions")
3. System proposes sources, actions, cadence, and safety mode
4. User confirms and saves
5. Coworker starts and posts first status update

Acceptance:
- User can create a useful coworker without editing JSON/YAML
- Coworker definition includes objective, sources, allowed actions, and schedule
- Coworker can spawn child coding runs when needed

### C) Long-running coworker lifecycle
User flow:
1. Coworker wakes from webhook/cron
2. Triages new work
3. Spawns child runs for concrete tasks
4. Reports progress and outcomes in its thread/channel
5. User asks "what did you finish today?" and gets a concrete answer

Acceptance:
- Repeated wake/sleep cycles work without manual intervention
- Parent/child runs are linked and inspectable
- User can pause/resume/cancel and update coworker objectives

### D) Coding session UX quality
Session must expose:
- Live terminal output
- Code changes and git diff
- Preview URL/app status
- Services/logs visibility
- Final PR/outcome summary

Acceptance:
- Session stream is responsive and reconnect-safe
- Final output always includes summary + links + failure reason (if failed)
- Visual proof artifact exists when UI/runtime behavior is part of the task

### E) Action safety and approvals
User flow:
1. Coworker requests side-effect action (for example comment, ticket update, deploy trigger)
2. System checks mode (`allow`, `require_approval`, `deny`)
3. If approval needed, inbox/slack notification is sent
4. Runtime is marked waiting and continues through standard idle lifecycle
5. Approver accepts or rejects
6. Coworker resumes with decision

Acceptance:
- Approvals are DB-backed and auditable
- Post-approval revalidation runs before delayed execution
- All invocations show actor, run-as identity, and credential owner
- Idle timeout defaults to `10m` for approval waits and normal inactivity

### F) Query from anywhere
Entry points:
- Web dashboard (primary)
- Slack/GitHub mentions (secondary)
- Later desktop client

Acceptance:
- User can ask status/questions and receive actionable links
- Dashboard works from durable DB state even during stream interruptions

## Integration model requirements (org-wide + personal)

### Org-wide connections
- Admins can connect org integrations (GitHub org bot, Sentry org project access, PostHog, analytics, shared MCP tools)
- Used by default for background coworkers

### Personal connections
- Users can connect personal tools/accounts
- Personal credentials are not silently reused for shared templates
- Sharing a coworker template prompts recipient to attach their own personal integration where required

### Actions page expectations
- One place to manage both org-wide and personal sources
- Clear badges for "Org" vs "Personal"
- Clear warnings before sharing coworkers that depend on personal integrations

## Implementation file references (current code anchors)

### UX and orchestration
- `apps/web/src/server/routers/automations.ts`
- `apps/web/src/server/routers/sessions.ts`
- `apps/web/src/server/routers/triggers.ts`
- `apps/worker/src/automation/index.ts`
- `apps/worker/src/automation/finalizer.ts`

### Runtime/coding sessions
- `apps/gateway/src/hub/session-hub.ts`
- `apps/gateway/src/hub/session-runtime.ts`
- `packages/shared/src/providers/e2b.ts`
- `packages/shared/src/sandbox/opencode.ts`

### Actions/integrations/approvals
- `apps/gateway/src/api/proliferate/http/actions.ts`
- `packages/services/src/actions/service.ts`
- `apps/web/src/server/routers/integrations.ts`
- `packages/services/src/integrations/service.ts`
- `packages/services/src/connectors/service.ts`

### Notifications and inbox
- `packages/services/src/notifications/service.ts`
- `apps/worker/src/automation/notifications.ts`
- `packages/services/src/outbox/service.ts`

## Key UX surfaces

### 1) Mission Control (org-level)
Shows:
- Active coworkers
- Running/failed/pending runs
- Approval queue
- Recent outcomes and links to PRs/issues

### 2) Coworker detail page
Shows:
- Objective, schedule, and source bindings
- Current status + last wake time
- Recent runs and spawned child runs
- Conversation/history ("what it did and why")

### 3) Session/run detail page
Shows:
- Live stream (terminal/events)
- Persisted timeline
- Tool/action outputs
- Git state, previews, logs, artifacts

### 4) Approval inbox
Shows:
- Pending action invocations
- Why action was requested
- Approve/deny controls
- Audit trail after decision

## Data model requirements (plain language)
Minimum durable records:
- Coworker/Agent
- Session
- Run (if separate)
- Action invocation
- Trigger event
- Inbox event
- Notification preference + channel target

Additional immutable runtime record:
- `boot_snapshot` on each session/run (prompt, model, grants, identity, env bundle references)

Why:
- Running work must not change behavior when live config edits happen
- Audit/replay must reflect exact allowed behavior at run start

Core tables that back this UX:
- `automations` (coworker identity, prompt, notification destination) — `packages/db/src/schema/automations.ts`
- `sessions` (interactive/child run state, runtime metadata) — `packages/db/src/schema/sessions.ts`
- `triggers` + `trigger_events` (wake pipeline, dedup, processing status) — `packages/db/src/schema/triggers.ts`
- `integrations` + `org_connectors` (OAuth and MCP source access) — `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts`
- `action_invocations` (approval and side-effect audit) — `packages/db/src/schema/schema.ts`
- `outbox` + `session_notification_subscriptions` (delivery and subscriber preferences) — `packages/db/src/schema/schema.ts`, `packages/db/src/schema/slack.ts`

## Non-goals (for V1)
- Full no-code workflow builder
- Arbitrary business-process automation marketplace
- Fully autonomous deploy/merge with zero guardrails

## Definition of done checklist
- [ ] Setup flow works from repo connect to first successful run
- [ ] Coworker can be created conversationally and run on schedule
- [ ] Persistent coworker wakes repeatedly and can spawn child runs
- [ ] Org + personal integration model is visible and safe
- [ ] Approval queue gates risky actions with auditability
- [ ] Dashboard is DB-first and resilient; detail views stream live state
- [ ] Session/run stores immutable `boot_snapshot` at creation time
- [ ] Coding runs publish visual proof artifact when task requires it
