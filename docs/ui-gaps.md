# UI Gaps — What's Missing

Tracking file for bringing the product UI up to the spec in `docs/updated-flows.md` and the visual quality of the `/inspiration` reference apps (Tembo, Lovable, Gumloop, ElevenLabs).

Last updated: February 2026

---

## Agent Runs / Triage (`/dashboard/runs`) — ~40% of spec

The runs page has basic triage list + filter tabs + search, but the core interaction model from the spec is missing.

- [ ] **Org-wide all-runs API endpoint** — current `listOrgPendingRuns` only returns failed/needs_human/timed_out. Need an endpoint that returns runs across all statuses so we can show "Running" and "Done" groups.
- [ ] **Running group** — show currently executing runs (status = `running`, `enriching`, `ready`, `queued`). Requires the new endpoint above.
- [ ] **Done group** — show recently completed runs (status = `succeeded`). Requires the new endpoint.
- [ ] **Detail panel slide-out** — spec says "click row → detail panel slides out with Triage Card". Currently items are flat inline cards with no expandable detail.
- [ ] **Triage Card (4 sections)** — TL;DR summary, Payload preview (code diff / Slack message / terminal error), Execution Trail (CI/CD-style collapsed timeline), Action Bar (approve/deny/quick-reply + claim & open).
- [ ] **Bulk operations** — "Approve All (N)" button for batching pending approvals.
- [ ] **Advanced filters** — automation name dropdown, repo filter, "Mine" vs "Org" toggle, time range. Currently only free-text search.
- [ ] **Claim & Open in Workspace** — button that navigates to `/workspace/:id` with pre-warmed state + persistent "Resumed from Automation" banner.

---

## Workspace / Session (`/workspace/:id`) — ~50% of spec

Core routing works but the header bar and Engine Room details need verification / buildout.

- [ ] **Session header bar (38px)** — escape hatch (logo → `/dashboard` with attention badge), separator, branch + repo name, origin badge (e.g. "From: Sentry Auto-Fixer"), agent live status (e.g. "Running tests..."), tools pill ("Sentry, GitHub, Linear" linking to integrations). Take heavy inspiration from Lovable's chat header (`/inspiration/lovable/chat_header.html`).
- [ ] **Engine Room right pane** — tabbed: Preview, Code, Terminal. Agent-controlled (opens files, runs commands, updates preview). Refer to Lovable's chat page for the two-pane IDE feel.
- [ ] **Dynamic Engine Room** — hidden when no repo attached (chat fills viewport); slides in when repo attached or agent executes code.
- [ ] **"Return to Agent Runs" button** — shown on claimed/automation-originated sessions.

---

## Dashboard Home (`/dashboard`) — ~70% of spec

Greeting, prompt input, recent sessions, onboarding cards all exist. Missing prompt input features.

- [ ] **Model selector** in prompt input — let users pick which model to use for the session.
- [ ] **File attach** — ability to attach files to the initial prompt.
- [ ] **Speech input** — microphone button for voice prompts.

---

## Session History (`/dashboard/sessions`) — ~60% of spec

List works but is sparse.

- [ ] **Origin column** — show whether session was manual or from an automation (with automation name).
- [ ] **Active status indicator** — more prominent display of running vs paused vs completed.
- [ ] **Search/filter** — text search + status filter for session list.

---

## Automations (`/dashboard/automations`) — ~70% of spec

List and creation work. Missing richer detail in list rows.

- [ ] **Richer list columns** — trigger type, action type, total run count, last run time alongside current name/status/updated_at.
- [ ] **Automation builder** — structured builder UI (deferred to post-V1 per spec, but tracking here).

---

## Integrations (`/dashboard/integrations`) — ~80% of spec

Catalog and connections work well.

- [ ] **Per-action toggles** — `Allow | Require Approval` toggle per action for each integration adapter. Show exact agent actions (e.g. `update_issue`, `read_logs`).

---

## Sign-In / Sign-Up — visual polish

Functional but missing brand presence. Take inspiration from Tembo login (`/inspiration/tembo/login.html`).

- [ ] **Split layout with brand hero** — left side: dark panel with logo, tagline, integration/action logos (connectors we support). Right side: auth form. Similar to Tembo's bright/dark split.
- [ ] **"Last used" indicator** — highlight the most recently used auth method.
- [ ] **Tighter form density** — reduce spacing between form elements per design system product density rules.

---

## Sidebar — polish

Functional and organized. Minor refinements.

- [ ] **Section header visual weight** — make section labels ("Monitor", "Configure") slightly more distinct with spacing or subtle background.
- [ ] **Experimental feature badges** — add "Beta"/"Alpha" labels to experimental features (like ElevenLabs does).

---

## Chat UI — major

The actual chat bubbles and message rendering inside the workspace. Spec says to strongly lean on Lovable's chat UI.

- [ ] **Chat bubble styling** — reference `/inspiration/lovable/chat_page.jsx` for message bubble layout, streaming state, tool output displays, code diff rendering.
- [ ] **Chat input area** — reference Gumloop's chat input with app indicator, attachment button, recommended actions.
- [ ] **Agent status indicators** — streaming state, "Analyzing...", tool call displays.

---

## Global Polish

Small refinements that add up to a premium feel across all pages.

- [ ] **Spacing audit** — standardize `gap-` and `p-` usage. Cards: `p-3`. Pages: `p-6`. Tight items: `gap-1`. Sections: `gap-4`.
- [ ] **Border consistency** — all borders use `border-border` token, never hardcoded. Verify across all components.
- [ ] **Shadow consistency** — cards use `shadow-keystone`, floating/popovers use `shadow-floating`.
- [ ] **Focus states** — audit all interactive elements have visible focus indicators using `ring` token.
- [ ] **Hover state consistency** — all interactive elements use either `hover:bg-muted/50` or `hover:bg-accent`, not mixed.
