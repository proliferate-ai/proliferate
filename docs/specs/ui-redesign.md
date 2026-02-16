# UI Redesign — Canonical Spec

> Single source of truth for the Proliferate UI redesign. Every frontend decision lives here.
> This document is prescriptive, not descriptive — it defines what we are building, not what exists today.

---

## 1. Design System & Aesthetic

The aesthetic target is **Raycast / Linear / Vercel**.

* **Colors:** Neutral, monochromatic palettes. Grays, off-blacks, and stark whites. Minimal accent colors used strictly for semantic states (e.g., Red for errors/deny, Yellow for warnings/drift, Blue for primary focus).
* **Typography:** High-contrast, highly legible. Heavy use of monospaced fonts (`ui-monospace`, `SF Mono`, `JetBrains Mono`) for technical data (hashes, IDs, file paths, parameters).
* **Motion:** Swift, eased, and intentional. **No pulsing, no glowing, no neon gradients, no 3D.** Use Framer Motion for structural layout transitions, but keep durations fast (`< 200ms`). Magic comes from speed and precision.
* **Navigation:** Keyboard-first (`Cmd+K`).

---

## 2. Two-World Architecture

The application has two distinct UI paradigms. They share auth and global state but have completely separate layouts, navigation, and mental models.

### World 1: The Studio (`/workspace`)

The "doing" world. Full-bleed IDE layout. No SaaS sidebar. The user is here to write code, talk to agents, and watch things happen in real time.

* **Layout:** Full-screen. Left sidebar = chat history only. Right = Developer Panel (Terminal, Changes, Preview, Artifacts). Bottom = chat input.
* **Navigation:** Minimal. A persistent top bar with a crisp `[ Inbox ]` badge is the only escape hatch to the Command Center.
* **Mental model:** "I am in the cockpit."

### World 2: The Command Center (`/dashboard`)

The "managing" world. Standard SaaS sidebar layout. The user is here to configure, approve, delegate, and monitor.

* **Layout:** Fixed sidebar on left. Content area on right. Standard vertical scroll.
* **Navigation:** Sidebar with sections for Inbox, Automations, Integrations, Repositories.
* **Mental model:** "I am in mission control."

### The Bridge Between Worlds

Users move between worlds via:

1. **Inbox indicator** — A static, high-contrast `[ 1 ] Inbox` badge in the Studio's top bar (solid dot or pill). When items arrive, it appears with a swift, crisp slide-in animation. Clicking it navigates to `/dashboard/inbox`.
2. **Audit Trail → Take Over** — Clicking a paused run in the dashboard opens an Audit Trail of the agent's actions. Clicking `[ Take Over in Studio ]` triggers a seamless layout transition to the Studio (`/workspace/:id`).
3. **Standard navigation** — Cmd+K palette, subtle back buttons.

---

## 3. Route Map

The architecture **must** use Next.js Route Groups to physically isolate the layouts.

### Public / Auth

| Route | Description |
| --- | --- |
| `/` | Landing page |
| `/sign-in`, `/sign-up` | Auth flows |
| `/auth/*` | Callbacks |
| `/invite/:id` | Accept org invitation |

### Onboarding

| Route | Description |
| --- | --- |
| `/onboarding` | Wizard (developer or organization flow) |
| `/onboarding/complete` | Post-Stripe-checkout landing |

### World 1: The Studio (Route Group: `(studio)`)

| Route | Description |
| --- | --- |
| `/workspace` | New session. Raycast-style centered command palette empty state. |
| `/workspace/demo` | Post-onboarding "Flight Simulator" demo chat. Pre-warmed snapshot. |
| `/workspace/:id` | Active or past chat session. Left sidebar = chat history only. |

### World 2: The Command Center (Route Group: `(command-center)`)

| Route | Description |
| --- | --- |
| `/dashboard` | Always redirects to `/dashboard/inbox`. |
| `/dashboard/inbox` | Approvals and failed runs. The hero feature. |
| `/dashboard/automations` | Automation list + recipe cards. |
| `/dashboard/automations/:id` | Automation detail / builder. |
| `/dashboard/automations/runs/:runId` | **Run Audit View:** Timeline of actions taken, leading to approval/take-over. |
| `/dashboard/repositories` | Repo list, add repos, configure environments. |
| `/dashboard/repositories/:id` | Repo detail (snapshots, service commands, secret files). |
| `/dashboard/integrations` | Unified Integrations hub (OAuth + MCP). |
| `/dashboard/integrations/:id` | Enterprise Access Control Matrix. |

### Settings (Route Group: `(settings)`)

| Route | Description |
| --- | --- |
| `/settings` | Redirects to `/settings/profile`. |
| `/settings/profile`, `/settings/general`, `/settings/members` | Standard settings. |
| `/settings/billing` | Billing & usage. **Admin only.** |

*(`/settings/tools` and `/settings/secrets` removed. Tools live in Integrations; Secrets live in Repositories.)*

### Route Group Directory Tree

```
src/app/
├── (auth)/                         # Auth pages (sign-in, sign-up, verify, invite)
│    ├── sign-in/page.tsx
│    ├── sign-up/page.tsx
│    ├── auth/...
│    └── invite/[id]/page.tsx
├── (studio)/                       # World 1: Full-bleed IDE layout
│    ├── layout.tsx                  # IDE shell: chat history sidebar, top bar with Inbox indicator
│    └── workspace/
│         ├── page.tsx               # Raycast command palette empty state
│         ├── demo/page.tsx          # Flight Simulator
│         └── [id]/page.tsx          # Active/past session
├── (command-center)/               # World 2: SaaS sidebar layout
│    ├── layout.tsx                  # Fixed sidebar: Inbox, Repos, Automations, Integrations
│    └── dashboard/
│         ├── page.tsx               # Redirect to /dashboard/inbox
│         ├── inbox/page.tsx
│         ├── automations/...
│         ├── repositories/...
│         └── integrations/...
├── (settings)/                     # Settings: own sidebar layout
│    ├── layout.tsx                  # Back button, nav, org switcher
│    └── settings/...
├── onboarding/                     # Onboarding wizard (standalone layout)
│    ├── layout.tsx
│    ├── page.tsx
│    └── complete/page.tsx
└── layout.tsx                      # Root: providers, fonts, global styles only
```

Key rules:
- `(studio)/layout.tsx` and `(command-center)/layout.tsx` share zero UI components. They are completely independent React trees below the root.
- Global state (Zustand stores, WebSocket listeners) lives above both layouts in the root `layout.tsx` providers. This is how the Inbox indicator in the Studio knows about events happening in the Command Center's domain.
- The root `layout.tsx` contains only: `<html>`, `<body>`, theme provider, auth provider, query client provider, Zustand hydration, global WebSocket listener. No visual chrome.

---

## 4. Permissions, Actions & Integrations

The platform balances "Magical End-User Experience" with "Enterprise-Grade Admin Security."

### For the End-User ("Magical Capabilities")

* To a standard developer, Integrations and Actions should just feel like "Capabilities" or "Skills" they are giving their agent.
* They go to `/dashboard/integrations` (if permitted) or the Automation Builder, see a clean grid of tools, and can easily connect their personal accounts (e.g., authenticating their own GitHub account so the agent's PRs have their name on them).
* It feels frictionless. If they ask the agent to do something, and they lack the capability, the agent just says: *"I can do that! I just need you to authenticate with Linear first: `[ Connect Linear ]`"*.

### For the Admin ("Enterprise Control")

* To an Admin, adding an MCP Connector or configuring an Org-wide OAuth app should feel like rigorous enterprise IT.
* Admins see the **Security Policies (Action Modes)** matrix. A data-dense, tabular view of every action an integration exposes (`sentry.update_issue`, `github.create_pull_request`).
* Next to each action is a segmented control: `[ Allow | Require Approval | Deny ]` (writes to `organizations.action_modes`).
* **Drift Detection:** If an underlying MCP tool schema changes, the UI explicitly flags the row with a yellow warning icon: *"Schema changed. Review required."* forcing the admin to re-verify the tool.

### Role Permissions Matrix

| Feature | Admin / Owner | Member |
| --- | --- | --- |
| Automations | Full access | Full access |
| Integrations (Platform) | **Connect new tools, set Org-wide Action Permission matrix.** | View available capabilities. Connect user-scoped OAuth (e.g. personal GitHub). |
| Repo Management | Add/Remove repos. | Read-only (use repos in sessions). |
| Secret Files | Full CRUD (Write-Only UI). | **Invisible.** |
| Billing | Full access. | Invisible. |

---

## 5. Onboarding & The "Flight Simulator" Mission

Do not block developers with a paywall upfront. Ask for their preferred tools (GitHub, Sentry, Linear), then drop them into `/workspace/demo` (a pre-warmed Next.js environment owned by us).

### Developer Flow (4 steps)

1. **Path choice** — "Developer" or "Company" cards.
2. **Tool selection** — Multi-select cards for all supported integrations.
3. **Billing / Start free trial** — Required step. Moves org out of `"unconfigured"` billing state. Copy must emphasize no charge during trial.
4. **Complete** — Drop directly into `/workspace/demo`. NOT the dashboard.

Auto-create organization for developer flow. No org creation step.

### Organization Flow (7 steps)

1. **Path choice** — Same as developer.
2. **Create organization** — Name only. Auto-generates slug.
3. **Questionnaire** — Where did you hear about us? Company website. Team size.
4. **Tool selection** — Same multi-select as developer flow.
5. **Invite members** — Email + role picker. "Skip for now" option.
6. **Billing / Start free trial** — Same as developer flow.
7. **Complete** — Drop directly into `/workspace/demo`. NOT the dashboard.

### The Flight Simulator Demo

Both flows end at `/workspace/demo`. Loads a **Globally Cached Demo Configuration** — a pre-warmed snapshot of a simple Next.js + Tailwind app (owned by Proliferate) with a known visual bug.

1. **Grok Environments:** Chat opens, boots in < 1s. Crisp toast: *"Environment restored from memory snapshot in 0.8s."*
2. **Grok Chats:** Agent says: *"I see a broken layout. Tell me to fix it."* User types "fix". Code diffs stream into the right panel.
3. **Grok Permissions:** Agent says: *"I'd open a PR, but I need your approval for write actions."* A crisp, inline card appears. User clicks `[ Approve & Always Allow ]`.
4. **Grok Automations:** Agent says: *"I've set up a background automation. Check your Dashboard."* User clicks to Dashboard, sees the Inbox.

### Billing Wall Strategy (Future)

When user tries to connect *their own* GitHub repo (`/dashboard/repositories/new`), trigger the 14-day trial Stripe modal. They are paying to unlock their code, not access a generic SaaS wrapper.

### Invited Users

1. If not authenticated, redirect to sign-in/sign-up with return URL.
2. Accept invitation page shows org name, "Welcome to [orgname]" heading, Accept/Decline buttons, expiration date.
3. Upon accepting, redirect to onboarding.

---

## 6. The Studio — Detail (`/workspace`)

### Empty State (`/workspace`)

* **Centered Command Palette:** Raycast-style search bar dead center. Crisp, light gray background (or pure dark mode), subtle noise texture, no gradients.
* **Context Pills:** Directly above the input, minimal 1px bordered pills: `[ Select Repository ]` and `[ 4 Capabilities Active ]`.
* **Framer FLIP Animation:** On `Enter`, the center search bar physically shrinks and snaps to the bottom of the screen (using `layoutId`), while the chat history and right panel snap into place.

### Active Session (`/workspace/:id`)

* **Left Sidebar:** Chat history only (Today, Previous 7 Days, grouped or chronological, with organize/sort/filter).
* **Main Area:** Chat thread with assistant-ui.
* **Right Panel:** Developer Panel (see §6.1 below).
* **Agent Status Badge:** Dynamic, monospace lifecycle status above chat input: `>_ Analyzing codebase...` → `>_ Running git grep...` → `[!] Waiting for approval`.
* **Session Header:** Minimal. Session title + environment dropdown + Settings gear dropdown on the far right.

### Session Loading

Fast. If from a pre-warmed snapshot, < 1 second. Show a sleek toast with timing data, not a generic spinner.

### 6.1 Developer Panel (Right Panel)

The Developer Panel is the developer's toolbox inside a session. It is the core "IDE feel" of the Studio. Beauty comes from **information density, rigorous sub-pixel alignment, stark contrast, and hairline borders.** It should feel like a machined piece of aluminum.

#### Container

* **The Split:** The screen is cleanly divided by a single, crisp 1px vertical border (`border-zinc-200` light / `border-zinc-800` dark). No drop shadows between chat and panel.
* **Drag Handle:** The vertical border is draggable. On hover: cursor changes to `col-resize`, a subtle `2px` vertical accent line appears instantly. Double-click snaps to 50% width.
* **Background Contrast:** If the Chat area is the absolute background color (`#FFFFFF` / `#000000`), the Developer Panel background is elevated one microscopic step (`bg-zinc-50` / `bg-[#0A0A0A]`). This creates a "sunken canvas" effect — the left side is conversation, the right side is the machine.

#### Tab Bar (Header)

A strict, flush tab bar anchored to the absolute top of the panel. Kill the floating ghost buttons.

```
Terminal    Changes [3]    Preview    Artifacts            [gear] [x]
----------------------------------------------------------------------
```

* **Typography:** `text-[12px] font-medium tracking-wide`. Geist or Inter.
* **Active State:** No pill backgrounds. Active tab = high-contrast text (`text-foreground`) + crisp `2px` bottom border flush with header's bottom border. Inactive tabs = `text-zinc-500`.
* **Live Badges:** Monospaced count directly in the tab: `Changes [3]`. No pulsing dots.
* **Settings/Environment controls:** Collapsed into a single gear dropdown icon on the far right, keeping tabs focused on output. Contains: session info, snapshot controls, auto-start config, theme toggle.

#### Tab: Terminal

Developers judge tools by their terminal. It must look like a raw PTY interface.

* **Canvas:** Force background to `#000000`, even in Light Mode. Anchors the screen visually.
* **Typography:** `JetBrains Mono`, `Geist Mono`, or `SF Mono`. 12px. Line height 1.5.
* **Color Palette:** Override default xterm.js colors with a muted, pastel syntax theme (e.g., Tokyo Night). Soft emeralds for success, muted blues for info, stark rose for errors.
* **Auto-Scroll:** Smoothly auto-scrolls to bottom as agent streams stdout. If user scrolls up even 1px, auto-scroll suspends and a floating transparent `[ Jump to bottom ]` pill appears.
* **Connection:** WebSocket to `/proxy/:sessionId/:token/devtools/terminal`. Handles string, ArrayBuffer, Blob messages. Sends resize events on container resize via ResizeObserver.
* **Services Strip:** Collapsible horizontal bar above terminal, visible only when services are running. Shows: chevron toggle, "Services" label, count badge, exposed port. Expands to service list with status dots, commands, stop/restart buttons, SSE log streaming.

#### Tab: Changes (Code/Diff Viewer)

Where the user verifies what the AI did. Must rival GitHub's PR viewer, but cleaner.

* **File Tree (Top):** Dense, un-padded file list (`h-8` per row). Directory path dimmed, filename highlighted: `<span class="text-zinc-500">src/components/</span><span class="text-foreground">button.tsx</span>`. Status indicators: rigid right-hand column of monospace colored letters — `A` (green), `M` (yellow), `D` (red).
* **Diff View (Bottom):** Immaculate unified diff. Extremely washed-out transparent backgrounds (`bg-green-500/10`, `bg-red-500/10`) with a bright solid `2px` left-edge border per changed line. Hunk headers (`@@ -12,4 +12,5 @@`) get subtle blue tint and 1px top/bottom border separators.
* **Git Operations:** Branch name + detached indicator, create-branch form, ahead/behind counts, commit form (message input + "Include untracked" checkbox), push button with warning text, create-PR form. Stacked vertical sections with uppercase tracking-wider labels.
* **Multi-repo:** Dropdown selector when multiple git repos exist.
* **Polling:** Git status every 5s. Activity ticks (agent file modifications) trigger 500ms-debounced query invalidations.

#### Tab: Preview (Mini-Browser)

Live web iframe when agent spins up a dev server.

* **Browser Chrome:** Minimalist chrome at top (`h-10 border-b border-border bg-muted/30`). Centered, muted pill with the local proxy URL in monospace font (read-only, click-to-copy). Three crisp 1px-stroke controls on left: `[ ← ]` `[ → ]` `[ ↻ ]`. Small `[ ↗ ]` icon on far right to open in external tab.
* **Polling:** Polls URL up to 5 times at 3s intervals. Falls back to CORS-then-no-cors detection.
* **Fullscreen:** `fixed inset-0 z-50`.
* **Empty state:** "No Preview Available — Start a dev server to see your app here."

#### Tab: Artifacts (Output Grid)

Generated files — PDFs, CSVs, PNGs, verification screenshots.

* **Layout:** Strict CSS Grid.
* **Cards:** Flat, `1px` borders. `rounded-md`. Wireframe file-type icon top-left. File size (`1.2 MB`) and extension (`.tsx`, `.png`) in tiny monospace at bottom.
* **Hover State:** Border shifts from `border-zinc-800` to `border-zinc-500`, tiny `[ ↓ ]` download icon appears top-right. Instant snap-state, no fades.
* **Actions:** Approve/deny buttons and "Approve with Grant" option (scope: session/org, max calls). Admin only.

#### Micro-Interactions

1. **Zero Layout Shift:** Switching tabs never resizes the container. Fixed box (`h-[calc(100vh-topbar)]`). Only interior content uses `overflow-y-auto`.
2. **Custom Scrollbars:** `w-[6px]`, transparent track, `bg-zinc-500/20` thumb that only appears when panel is hovered.
3. **Loading States:** No spinners for data loading — use fast left-to-right shimmer skeletons mimicking code line shapes. Terse monospace status line (`Connecting...`) for terminal/VS Code connection states.
4. **Focus Rings:** Stark 1px `ring-zinc-400` outline with `ring-offset-0`. No fuzzy browser glow.

#### Mobile Behavior

On mobile, only one view is visible at a time — chat or panel, never side-by-side. A toggle button in the header switches between them (`mobileView: "chat" | "preview"`). Panel's close button sets `mobileView` back to "chat".

#### Modal Mode

`CodingSession` can render inside a dialog (`asModal`). Layout lives in `max-w-4xl h-[85vh]` dialog content container. Same internal layout rules apply.

#### Data Flow

Panels that need sandbox access (Terminal, Changes, Artifacts) authenticate via a WebSocket token from `useWsToken()` and hit the gateway's proxy endpoints at `/proxy/:sessionId/:token/devtools/...`. Git operations go through WebSocket messages to the session hub — not HTTP. Activity ticks (emitted when the agent modifies files) trigger 500ms-debounced query invalidations so Changes and Artifacts stay current without manual refresh.

---

## 7. The Command Center — Detail (`/dashboard`)

### Dashboard Home

`/dashboard` always redirects to `/dashboard/inbox`. No conditional logic. No prompt input on the dashboard. Session creation happens exclusively in `/workspace`.

### `/dashboard/inbox` & Run Audit View (The Hero Feature)

**Empty state:**

* A crisp, monochrome, static illustration of an organized desk or empty tray.
* Copy: "Inbox Zero. Your agents are working quietly. Approvals and paused runs will appear here."

**With items:**

* Each item shows: automation name, action requested, agent status.
* **Action Haptics:** Clicking `[ Approve ]` instantly depresses it, shows a crisp micro-spinner, turns into a solid checkmark before the item closes.
* `[ Approve & Always Allow ]` option available.

**Run Audit View (`/dashboard/automations/runs/:runId`):**

When a user clicks an Inbox item (or a specific Automation Run), they do NOT instantly teleport to the Studio. They open the **Run Inspector** (full-page view or wide drawer).

* **The Timeline:** Chronological, Raycast-style list of exact actions from `action_invocations` DB:
  * `[ 08:01 ] ✓ Read file: src/utils.ts`
  * `[ 08:02 ] ✓ Terminal: npm run test`
  * `[ 08:03 ] ✋ PENDING: github.create_pull_request (Awaiting Approval)`
* **Resolution:** User can review JSON parameters and click `[ Approve Once ]`, `[ Deny ]`, or `[ Approve & Always Allow ]`.
* **The Handoff:** If the user realizes the agent needs course correction, they click `[ Take Over in Studio ]`. This teleports to `/workspace/:id` with persistent banner: "Resumed from Automation."

### `/dashboard/integrations` & `/dashboard/integrations/:id`

**List view:**
* OAuth connection cards (GitHub, Sentry, Linear, Slack).
* MCP tool connector grid with quick-setup forms.

**Detail view — Enterprise Governance (`/dashboard/integrations/:id`):**

* **Tab 1: Connection** — API key / OAuth status.
* **Tab 2: Security Policies (Action Modes)** — High-density data table.
  * Columns: `Action`, `Description`, `Access Policy`.
  * Access Policy column: segmented control `[ Allow | Require Approval | Deny ]`.
  * **Drift Detection:** If MCP tool hash changes, row gets subtle yellow background + `Review Required` warning icon. Admin MUST re-verify.

### `/dashboard/automations`

**Empty state:**
* Grid of highly legible **Recipe Cards** with crisp typography.
* CTAs: `[ Sentry Bug Fixer ]`, `[ Stale PR Reviewer ]` — clicking pre-fills the builder.

**The Builder (`/dashboard/automations/new`):**

Rebuilt as a clean, vertical 4-step wizard (no "Triggers" noun):

1. **WHEN:** Select Capability → Select Event → Set Filters.
2. **WHERE:** Select codebase.
3. **WHAT:** Agent instructions (Prompt).
4. **HOW:** Permission Overrides (inherits from workspace, allows specific lockdown for this automation).

**With automations:**
* Linear-style list view of automation cards with status, trigger count, last run.

### `/dashboard/repositories` & `/dashboard/repositories/:id`

**Empty state:**
* Copy: "Give your agents a home. Connect your codebase to generate lightning-fast memory snapshots."
* CTA: `[ Connect GitHub ]`.

**Detail view:**
* **Configuration:** Service commands, snapshot status.
* **Secret Files (Admin Only):** Vercel-style file editor writing to `secret_files`. Existing secrets are **Write-Only** — textarea placeholder: *"Value hidden for security. Paste new content to overwrite."* Members cannot see this tab.

**With repos:**
* Repo list with expandable rows showing configurations, service commands, snapshot status.

---

## 8. Command Palette (Cmd+K)

First-class citizen. `Cmd+K` is available globally.

* Type `New` → `Start new Chat (Interactive)`, `Create Automation (Background)`, `New Environment Configuration`.
* Places nouns directly next to each other to teach the user the platform's vocabulary.
* Standard search across sessions, automations, repos, settings.

---

## 9. Sidebar Structures

### Studio Left Sidebar (`/workspace`)

```
[Logo]
[+ New session]
[Search / Cmd+K]
-----------------
Threads
  [Organize] [Add Snapshot]
  (Session list — grouped by project or chronological)
  (Sort: updated / created)
  (Filter: all / running / paused)
-----------------
[Support]
[User card -> Settings, Theme, Sign out]
```

### Command Center Sidebar (`/dashboard`)

```
[Logo]
[+ New Session]              <-- Primary, high-contrast. Navigates to /workspace.
[Search / Cmd+K]
-- Workspace --
  Inbox (badge count)
  Repositories
-- Agents --
  Automations
  Integrations
-----------------
[Support]
[User card -> Settings, Theme, Sign out]
```

No session list. No "Threads" section. Sessions live in the Studio only.

### Settings Sidebar (`/settings`)

```
[<- Back to Dashboard]
-- Account --
  Profile
-- Workspace --
  General
  Billing (admin only)
  Members
-----------------
[Org switcher]
```

---

## 10. UX Polish & Interaction Requirements

* **Action Haptics:** "Human Approval" is the core mechanic. Clicking `[ Approve ]` instantly depresses, shows crisp micro-spinner, turns into solid checkmark before the card closes.
* **Empty State Media:** No videos or pulsing 3D assets. Use high-quality, monochromatic SVG wireframes or typography-driven empty states that look like developer tools.
* **Layout Transitions:** Use Framer Motion `layoutId` to animate elements moving between states (e.g., centered Workspace prompt → bottom chat input). Keep durations < 200ms.
* **Data Rendering:** All IDs, paths, API JSON payloads, and Git SHAs must use a monospace font.
* **Agent Status:** Do NOT use typing dots. Use monospace lifecycle status: `>_ Analyzing codebase...` → `>_ Running git grep...` → `[!] Waiting for approval`.
* **Notification Indicator:** The `[ Inbox ]` badge in Studio's top bar. Default: subtle. On arrival: crisp slide-in with count. Only bridge pulling users from Studio → Command Center.

---

## 11. Billing

* Provider: Autumn.
* 1 credit = 1 cent.
* All plans pay for credits based on monetary value.
* Top-ups cost 20% extra (incentive to pick a plan).
* All plans have free trial (default top-up amount).
* Compute cost to user: 1 cent per minute.
* Model cost to user: our cost * 3.
* Persistent billing display somewhere visible (banner, sidebar footer, or settings).
