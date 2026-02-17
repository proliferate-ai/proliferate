
# Proliferate — Product Layout Design Doc

**Last updated:** February 2026 · **Status:** Ready for wire-framing

---

## Overview / Philosophy

- **Dashboard-first architecture** — the dashboard (`/dashboard`) is the single home surface; the workspace (`/workspace/:id`) is a focused detail view you enter when you want to interact with a session
- All sessions are created from the dashboard — type a prompt, pick a repo (optional), hit enter. The session spins up in the background and appears in your recent sessions list
- Clicking into a session opens the workspace: a full-bleed, immersive chat + IDE view
- No separate "workspace landing page" — the dashboard prompt IS the session creation UI
- Agent Runs = Linear-style triage, **not** inbox
	- Grouped by status, not chronology
	- Items move between statuses, never disappear
	- Persistent fleet health view, not a to-do list

---

## Overarching Layout & UX Flows

### Session creation flow

1. User is on `/dashboard` — sees greeting, prompt input, recent sessions, onboarding cards (if applicable)
2. User types a prompt, optionally selects a repo/snapshot and model
3. Session is created → user is navigated to `/workspace/:id` where the chat begins
4. If the user navigates away mid-session, the session stays in "Recent Sessions" on the dashboard
5. Clicking a recent session re-opens the workspace at `/workspace/:id`

### Navigating between dashboard and workspace

- **Dashboard → Workspace**
	- Submit a prompt on the dashboard home → creates session, opens workspace
	- Click any session in "Recent Sessions" → opens workspace
	- Click any session on `/dashboard/sessions` → opens workspace
	- "Claim & Open" on a triage card → opens workspace with pre-warmed state
- **Workspace → Dashboard**
	- Logo / back button in the workspace header → `/dashboard`
	- Red dot badge when agents need attention on the dashboard side
- **New chat from workspace**
	- "New chat" button in sidebar (when sidebar visible) → clears active session, returns to `/dashboard`

### Claiming flow (critical path)

- User clicks "Claim" on an Agent Run triage card
- Workspace opens with the session pre-warmed: code editor on exact file, terminal at exact state, chat at exact blocker
- Persistent banner: "Resumed from Automation" + "Return to Agent Runs" button
- User pair-programs with agent, then returns to triage

### Dynamic layout behavior

- No repo attached → Engine Room hidden, chat fills viewport (lightweight chat UI)
- Repo attached or agent executes code → Engine Room slides in, becomes split-pane IDE

### Access control

- UI filtering, not separate pages
- **Admin-only:** billing, repo connections, adding integrations, secrets
- **All users:** profile, creating automations, toggling integrations, inviting teammates
- Non-admins don't see restricted items (no disabled states)

---

# Sections

## Dashboard (`/dashboard`)

- Standard SaaS left-sidebar layout
- **Sidebar nav items:**
	- Home, Agent Runs (with attention badge), Sessions, Automations, Repositories, Integrations
	- Separator
	- Settings (gear icon), User profile
	- New chat button (logo icon) → clears active session, goes to dashboard home
- Fleet management: scanning, triaging, configuring
- All session history lives here, not in workspace

## Workspace (`/workspace/:id`)

- Full-bleed, Lovable-style two-pane IDE — entered by clicking into a specific session
- **Left: Chat** — full-height conversation with agent
	- Streaming code diffs, inline permission cards, agent status indicators
	- Session header bar (38px) at top — the **only** nav surface
- **Right: Engine Room** — tabbed: Preview, Code, Terminal — the interface here should refer to `Lovable`
	- Agent-controlled — agent opens files, runs commands, updates preview
	- User focuses on conversation, tooling responds automatically
- No file tree, no sidebar, no navigation drawer, no session history
- Session header contents (left → right):
	- Back / escape hatch (logo → `/dashboard`, with attention badge)
	- Separator
	- Branch + repo name
	- Origin badge if from automation (e.g., "From: Sentry Auto-Fixer")
	- Agent live status (e.g., "Running tests...")
	- Tools pill ("Sentry, GitHub, Linear" → links to integrations config)

## Settings (`/settings`)

- Same sidebar shell as Dashboard (embedded under command-center layout)
- Nav items swap to: Profile, General, Members, Secrets (admin), Billing (admin)
- Accessed via gear icon at bottom of Dashboard sidebar
- Non-admin users simply don't see admin-only items

---

# Pages

## `/dashboard` — Dashboard Home

- Hero area: personalized greeting + prompt input (centered at top)
- Prompt input with: model selector, repo/snapshot picker, file attach, speech input
- **"Get Started" section** — onboarding cards (connect repo, link GitHub, link Slack, create automation) — animated in, disappears once setup is complete
- **"Recent Sessions" section** — compact list of up to 5 recent sessions with status dot, title, repo, time ago — "All Sessions" link to `/dashboard/sessions`
- No separate `/workspace` landing — the dashboard IS the front door for creating sessions

## `/workspace/:id` — Active Session

- Two-pane IDE: Chat (left) + Engine Room (right)
- Identical layout regardless of origin (manual, claimed from automation, one-off)
- Origin badge in header provides context
- If claimed from automation:
	- Persistent banner: "Resumed from Automation"
	- "Return to Agent Runs" button

## `/dashboard/runs` — Agent Runs (Triage)

- Linear-style grouped list, **not** chronological inbox
- **Grouped by status:** Needs Help (red), Waiting for Approval (purple), Running (green), Done (gray)
- Within each group: sorted by recency
- **Filter bar:** automation name, repo, "Mine" vs. "Org," time range
- **Bulk operations:** "Approve All (4)" for pending runs
- Click row → **detail panel slides out** with Triage Card
- **Triage Card (4 sections):**
	- **TL;DR** — 1-2 sentence summary of what agent did + why it paused
	- **Payload** — read-only preview of the action (code diff, Slack message mockup, terminal error)
	- **Execution Trail** — collapsed CI/CD-style timeline (e.g., "Cloned repo → Edited cache.ts → Waiting for permission")
	- **Action Bar** — two paths:
		- **Fast path:** Approve / Deny / Quick-reply → runs in background, user stays in triage
		- **Slow path:** Claim & Open in Workspace → transitions to pre-warmed IDE session
- **Empty state:** "All clear. Your agents are working quietly in the background."

## `/dashboard/sessions` — Session History

- All past + active coding sessions
- Each row: title, repo, origin (manual vs. automation name), active status
- Click any session → opens workspace at `/workspace/:id`

## `/dashboard/automations` — Automation Configs

- List view with tabs: "All," "Mine," "Org-wide"
- Each row: trigger, action, run count, last run time, active/paused status
- "+ New" button → automation builder
- Empty state: pre-built recipe cards that pre-fill builder on click

## `/dashboard/repos` — Repositories

- Connected codebases with language, last snapshot time, connection status
- Visible to all users; adding repos + editing secrets is admin-only
- Environment setup wizards run as workspace sessions at `/workspace/setup/:repo-id`
- "+ Connect Repository" button (admin)

## `/dashboard/integrations` — Integrations

- "App store" for MCP servers, OAuth connections, action permissions
- Each integration shows exact agent actions (e.g., `update_issue`, `read_logs`)
- Per-action toggles: `Allow | Require Approval`
- **Admins:** add integrations, enforce org-level policies
- **Non-admins:** toggle personal integrations on/off from admin-configured set

---

# Onboarding

## New Users

- Two entry flows (Developer / Organization), converge on same post-signup experience
- **Shared steps:**
	- Tool selection (integration cards — GitHub, Sentry, Linear, Slack, PostHog)
	- Billing (start free trial, emphasize $0 during trial) — gate to exit onboarding (skipped when billing disabled)
- **Developer flow:** auto-creates org, no org creation step
- **Organization flow:** create org (name only), questionnaire (source, website, team size), invite teammates
- Both flows land on `/dashboard` after completion

## Invited Users

- Accept invite page (sign in / create account if needed)
- Shows org name + welcome message
- On accept → same onboarding flow

---

# V1 Scoping

## Ship

- Dashboard-first layout — dashboard is home, workspace is detail view
- Dashboard home: greeting + prompt input + recent sessions + onboarding cards
- Workspace: Lovable-style two-pane (chat + Engine Room), no file tree
- Dynamic Engine Room (hidden for one-off, expanded for repo sessions)
- Session header bar: escape hatch, repo context, agent status, tools pill
- Dashboard pages: Agent Runs triage, sessions, automations, repos, integrations
- Triage card: TL;DR, payload, execution trail, dual-action bar
- Bulk approve
- "Return to Agent Runs" on claimed sessions
- Settings with role-based visibility (embedded in dashboard sidebar)
- Card-based onboarding flow (path choice, org creation, questionnaire, tools, invite, billing, complete)

## Defer Post-V1

- Cmd+K command palette
- End users connecting personal MCP tools
- Admin-created assistants/personalities by user group
- Retention mechanics beyond onboarding cards
- Elaborate empty state videos
- Visual Recipe Builder for automation creation (ship structured builder first)
- Onboarding demo environment (`/workspace/demo`)
- GSAP animation choreography (spatial transitions, glowing wires)
