# UI Gaps — What's Missing

Tracking file for bringing the product UI up to the spec in `docs/updated-flows.md` and the visual quality of the `/inspiration` reference apps.

Last updated: February 2026

---

## Agent Runs / Triage (`/dashboard/runs`)

The runs page has basic triage list with status grouping, filter tabs, and search. The core detail interaction model from the spec is the main gap — plus backend endpoints needed to support it.

### Frontend

- [ ] **Detail panel slide-out** — spec says "click row → detail panel slides out with Triage Card". Currently items are flat inline cards with no expandable detail.
- [ ] **Triage Card (4 sections)** — TL;DR summary, Payload preview (code diff / Slack message / terminal error), Execution Trail (CI/CD-style collapsed timeline), Action Bar (approve/deny/quick-reply + claim & open).
- [ ] **Running group** — show currently executing runs (status = `running`, `enriching`, `ready`, `queued`). Requires the org-wide all-runs endpoint below.
- [ ] **Done group** — show recently completed runs (status = `succeeded`). Requires the endpoint below.
- [ ] **Bulk approve button** — "Approve All (N)" for batching pending approvals.
- [ ] **Advanced filters** — automation name dropdown, repo filter, "Mine" vs "Org" toggle, time range. Currently only free-text search.
- [ ] **Claim & Open in Workspace** — button on triage card that navigates to `/workspace/:id` with pre-warmed state.

### Backend

- [ ] **Org-wide all-runs endpoint** — current `listOrgPendingRuns` only returns `failed`/`needs_human`/`timed_out`. Need a new endpoint (or expand it) to return runs across all statuses with optional grouping, so the frontend can show Running and Done groups.
- [ ] **Run detail endpoint** — single endpoint returning fully-resolved triage card data: run summary, enrichment payload, execution event trail, assignee info, trigger event context. The data exists in DB (`automationRunEvents` table, enrichment_json on run) but isn't exposed as a cohesive endpoint.
- [ ] **Run event trail endpoint** — list all `automationRunEvents` for a given run (status transitions, enrichment saves, manual resolutions). Needed for the Execution Trail section in the Triage Card.
- [ ] **Bulk resolve endpoint** — batch version of `resolveRun()`. Currently single-run only; frontend would need to loop N times.
- [ ] **Triage filter params** — add `automation_id`, `repo_id`, `assigned_to` (me/org), `since` query params to the runs listing endpoint.

---

## Workspace Header (`/workspace/:id`)

The workspace has a full two-pane layout (chat + Engine Room with Preview/Code/Terminal/Git/Artifacts/Settings tabs), model selector, file attach, speech input, approval tray — all working. The main gap is the **session header bar** described in the spec.

- [ ] **Session header bar** — the current header has a back button, logo, session title, and panel tab picker. The spec calls for a richer bar: escape hatch (logo → `/dashboard` with attention badge), separator, branch + repo name, **origin badge** (e.g. "From: Sentry Auto-Fixer"), **agent live status** (e.g. "Running tests..."), **tools pill** ("Sentry, GitHub, Linear" linking to integrations config). Take inspiration from Lovable's chat header (`/inspiration/lovable/chat_header.html`).
- [ ] **Origin badge** — sessions don't currently track which automation spawned them. The session object has `origin: "web" | "cli"` but no `automationId`/`automationName` field. Backend needs to store this when a run creates a session.
- [ ] **"Return to Agent Runs" button** — persistent banner on automation-originated sessions linking back to the triage page. Currently the automation banner exists (`?from=automation`) but just shows "Resumed from Automation" with a close button — no link back.

---

## Session History (`/dashboard/sessions`)

Has filter tabs (All/Active/Stopped), search, status dots, click-to-open. One data gap.

- [ ] **Origin column** — spec says each row should show "origin (manual vs. automation name)". Not currently displayed. Requires backend to expose automation source on session objects (same as the origin badge above).

---

## Sign-In / Sign-Up — visual polish

Functionally complete (OAuth + email, verification, redirect preservation). Visual treatment is basic.

- [ ] **Split layout with brand hero** — left side: dark panel with logo, tagline, integration/action logos (connectors we support). Right side: auth form. Inspired by Tembo login (`/inspiration/tembo/login.html`).

---

## Chat UI — visual polish

The chat has user/assistant message bubbles with markdown, tool call displays, streaming, approval cards, model selector, attachments, and speech. The gap is visual refinement vs. the inspiration.

- [ ] **Chat bubble styling pass** — reference `/inspiration/lovable/chat_page.jsx` for message bubble layout, spacing, streaming state rendering, tool output displays. Current bubbles are functional but could be more polished.
- [ ] **Chat input area refinement** — reference Gumloop's chat input for visual treatment (glassmorphism, app indicator pill, recommended actions dropdown).

---

## Global Polish

- [ ] **Spacing audit** — standardize `gap-` and `p-` usage across all pages per design system density rules.
- [ ] **Border consistency** — verify all borders use `border-border` token, never hardcoded.
- [ ] **Shadow consistency** — cards use `shadow-keystone`, floating/popovers use `shadow-floating`.
- [ ] **Focus states** — audit all interactive elements have visible focus indicators using `ring` token.
- [ ] **Hover state consistency** — all interactive elements use consistent hover treatment.

---

## Already Complete (removed from tracking)

These were previously listed as gaps but are actually implemented:

- ~~Dashboard home model selector~~ — exists in PromptInput component
- ~~File attach~~ — exists in PromptInput (image support with thumbnails)
- ~~Speech input~~ — exists in PromptInput (browser SpeechRecognition API)
- ~~Engine Room right pane~~ — fully built: Preview (iframe), Code (OpenVSCode Server), Terminal (xterm.js over WS), Git (status/branch/commit/push/PR), Artifacts (file viewer gallery), Settings (info/snapshots/auto-start)
- ~~Dynamic Engine Room~~ — 35/65 split layout with mobile responsive toggle
- ~~Automations richer list columns~~ — has Name, Scope, Triggers, Actions, Created, Updated columns
- ~~Integrations per-action toggles~~ — exist in MCP connector detail modal (Allow/Require Approval/Disabled per action)
- ~~Sessions search/filter~~ — has filter tabs (All/Active/Stopped) + search input
- ~~Repos page~~ — feature-complete
- ~~Onboarding flow~~ — feature-complete (developer/org paths, tools, billing, questionnaire, invite)
- ~~Settings pages~~ — feature-complete (profile, general, members, secrets, billing)
- ~~Sidebar organization~~ — has Monitor/Configure sections with proper grouping
