# Right Panel — Golden UX Spec

**Date:** 2026-02-19
**Status:** Aligned draft

This doc defines the target UX for the coding session right panel. It covers structure, states, interaction patterns, and per-panel behavior. All visual decisions follow the existing product design language (monochrome tokens, compact density, `border-border/50` rows, `bg-muted/30` surfaces, no tinted callouts).

---

## 1. Principles

1. **Immediate response.** Every action shows feedback quickly.
2. **Fast recovery.** Failures surface fast and always offer retry.
3. **No blank states.** Every possible state has an intentional visual.
4. **Consistent vocabulary.** All panels use the same state model and shell.
5. **Progressive disclosure.** Show essentials first; diagnostics on demand.
6. **Design-system discipline.** Semantic tokens only. No hardcoded colors, no tinted boxes, no decorative elements.

---

## 2. Shared Panel Shell

Every panel renders inside `PanelShell`. The shell owns all chrome.

**Header** (`h-10`, `px-3`, `border-b border-border`, `bg-muted/30`):
- Left: optional icon (`h-4 w-4`, `text-muted-foreground`) + title (`text-sm font-medium truncate`)
- Right: action buttons (`h-7 w-7`, ghost variant) + divider + close button (X)
- Close always present, sets mode to `none`

**Content** (`flex-1 min-h-0`):
- Default: `overflow-y-auto` scrollable content
- Edge-to-edge (`noPadding`): for iframes, terminals, log viewers
- Must fill height — no orphaned whitespace

---

## 3. Shared State Model

Every panel implements these states. No panel invents its own vocabulary.

### Empty
Panel is valid but has nothing to show (no URL, no services, no variables).
- Centered vertically and horizontally
- Contextual illustration (small, monochrome, `muted-foreground/35` strokes, 64-66px)
- Primary message: `text-sm font-medium`
- Hint: `text-xs text-muted-foreground`
- Optional CTA: `variant="outline" size="sm"`

### Loading / Connecting
Panel is doing async work before it can show content.
- Simple operations: spinner (`Loader2 h-5 w-5 animate-spin text-muted-foreground`) + label (`text-xs text-muted-foreground`)
- Multi-stage operations: determinate progress bar + stage labels
- If stalled beyond timeout, transition to Error/Unavailable

### Error / Unavailable
Something failed or timed out.
- Primary message: `text-sm font-medium` — human-readable summary
- Description: `text-xs text-muted-foreground` — what went wrong
- Retry button: always present, `variant="outline" size="sm"`
- Optional secondary action (e.g. "Open Services")
- Diagnostics: collapsible, hidden by default. When expanded: `bg-muted/50 border rounded-md p-3`, `text-[11px] font-mono text-muted-foreground whitespace-pre-wrap`
- No red error icons as primary visual. Red is for truly broken states only.

### Ready
Content visible. No overlays, no spinners.

---

## 4. Tab Bar

- Clicking an inactive tab opens that panel
- Clicking the active tab closes it (mode → `none`)
- Key tabs stay pinned (default: Preview, Code); others in overflow menu
- Users can pin/unpin from overflow
- Panel can move to opposite layout side
- Tabs may show subtle attention indicators (no color — use `text-foreground` weight)
- Labels: `Preview`, `Code`, `Terminal`, `Git`, `Services`, `Files`, `Env`, `Settings`

Special:
- `Env` shows missing-variable count badge when > 0
- `Investigation` auto-appears and auto-opens when `runId` is present

---

## 5. Panel Specs

### 5a. Preview

**Goal:** Show the user's running app preview reliably.

**States:** Empty → Connecting → Ready | Unavailable

**Empty** (no URL): illustration + "No preview available" + "Start a dev server to see your app here"

**Connecting** (URL set, server not confirmed): URL bar visible. Content area shows spinner + "Connecting to preview..." Capped at ~15s before transitioning to Unavailable.

**Ready:** URL bar + full-bleed iframe. No overlay.

**Unavailable:** Illustration + "Preview not ready" + "The dev server hasn't started yet" + Retry button.

**URL bar** (below shell header, above content):
- Read-only input showing the URL (`text-xs text-muted-foreground bg-muted/50 border-none`)
- Click to copy (toast: "URL copied")
- Always visible when URL exists

**Header actions:**
- Refresh (re-triggers readiness check + iframe reload)
- Fullscreen toggle (fixed overlay, Esc to exit)
- Open in new tab (external link)

---

### 5b. Code (VS Code)

**Goal:** In-browser VS Code editor with predictable startup.

**States:** Starting → Ready | Error

**Starting:** Spinner + "Starting editor..." + determinate progress bar with three stage labels:
- Request (10%) → Process (45%) → Network (80%) → Ready (100%)
- Active stage: `text-foreground`, others: `text-muted-foreground`
- `text-[10px] uppercase font-semibold tracking-wider`

**Ready:** Full-bleed iframe, edge-to-edge.

**Error:**
- "Failed to start VS Code" + description
- Retry button + "Open Services" secondary button
- Collapsible diagnostics: last 8 lines of process logs in `bg-muted/50 border rounded-md p-3`

---

### 5c. Terminal

**Goal:** Always-available shell inside the sandbox.

**States:** Connecting → Connected | Disconnected

No empty state — terminal always has a prompt.

**Connection badge** (in shell header actions area):
- Small colored dot + label: "Connecting" (yellow pulse), "Connected" (green), "Disconnected" (gray)

**Rendering:** Edge-to-edge (`noPadding`), xterm.js, colors from CSS custom properties.

**Reconnect:** Auto-reconnect after 2s on WebSocket close. After 3 consecutive failures, show banner: "Connection lost. [Reconnect]"

---

### 5d. Git

**Goal:** Observe git status and perform common operations. Clean enough for non-technical users.

**States:** Loading → Ready | Error

**Single scrollable view** (no sub-tabs):

1. **Branch bar:** Current branch name + ahead/behind badges. "Create branch" inline form (expands on click).

2. **Changes:** File counts grouped by status (staged, modified, untracked, conflicted). Each group is a collapsible list of filenames (display-only, no click action). Uses standard row styling: `border-b border-border/50`, `text-sm`.

3. **Commit:** Message input + "Include untracked files" checkbox + Commit button. Only visible when there are changes.

4. **Push:** Sync status ("Up to date" / "2 ahead" / "1 behind") + Push button.

5. **Pull Request:** Collapsed by default. Title + body + base branch + Create PR button.

6. **Recent commits:** Last 5 commits. Compact one-line format: short hash + message + relative time. Standard metadata styling: `text-xs text-muted-foreground`.

**Errors:** Inline, contextual to the action that failed. No blocking overlays.

---

### 5e. Services

**Goal:** Inspect running sandbox services and view their logs.

**States:** Loading → Empty | Ready

**Empty:** "No services running" + hint text, centered.

**Ready — two zones:**

**Top: Service tabs.** Horizontal row of tabs, one per running service. Each tab shows service name + status dot (green running, gray stopped, `text-destructive` error). Click a tab to toggle its log pane on/off. Multiple can be active at once.

**Bottom: Log panes.** Active tabs' logs shown side-by-side horizontally, equal-width columns. Each pane is a scrollable terminal-style log viewer (`noPadding`, monospace, auto-scroll) with the service name as a small header.

If no service tabs are selected: "Select a service above to view logs" centered in the bottom area.

Service tab styling follows standard tab patterns: `text-xs`, active tab highlighted with `bg-secondary`.

---

### 5f. Env

**Goal:** Manage environment variables confidently.

**States:** Loading → Empty | Ready

**Visual style:** Follows Vercel-style env table pattern, adapted to our design tokens.

**Layout:**

**Top: Add form.** KEY input + value input (password type) + Add button, row layout. Enter key submits. Toggle: "Save to vault" (persistent) vs "Session only" (ephemeral). "Paste .env" mode for bulk import (textarea + count + Cancel/Import).

**Missing keys section** (conditional): Required variables from configuration spec that aren't set. Each row: key name + "missing" label in `text-destructive text-xs` + "Set" button that focuses the add form.

**Variable list:** Vercel-inspired clean rows using our design tokens:
- Each row: `border-b border-border/50 hover:bg-muted/50 transition-colors px-4 py-2.5`
- Left: variable name (`font-mono font-medium text-sm`, click to copy)
- Middle: hidden value (bullet dots `text-muted-foreground`) + reveal button (eye icon, `h-4 w-4`)
- Right: overflow menu (`MoreVertical`) for edit/delete actions
- No monospace for metadata — only the key name uses mono

**Search:** Appears when total items >= 6. Standard search input pattern: `pl-8 h-8 w-48 text-sm` with search icon.

**Delete:** Inline two-step confirmation via overflow menu. No tinted confirmation dialogs.

**Status line** (below add form): "N required variables missing" (`text-xs text-muted-foreground`) or "All required variables set."

---

### 5g. Settings

**Goal:** Session metadata and configuration in one place.

**States:** Loading → Ready

**Single scrollable view** (no sub-tabs). Sections separated by `border-b border-border/50 pb-4 mb-4`:

1. **Session info:** Compact key-value pairs. Label (`text-xs text-muted-foreground`) + value (`text-sm`) on the same line or stacked. Fields: repo, branch, snapshot ID, start time, concurrent users, status. No stat cards, no decorative elements.

2. **Snapshot:** Current snapshot info + "Save snapshot" button (`variant="outline" size="sm"`, with loading state).

3. **Auto-start:** Configure service commands that run on session start. Command input + Add button. List of configured commands with delete buttons. Recent execution history (last 5 runs with timestamp and success/fail status as inline `text-xs text-muted-foreground`).

---

### 5h. Workspace (Artifacts)

**Goal:** Review produced artifacts and action approvals.

**States:** Empty → Actions | Gallery | File viewer

**Empty:** "No artifacts yet" + hint text.

**Actions view:** Action approval cards. Each card shows action name, description, risk level. Approve/Reject buttons. Result display after resolution. Cards use standard styling: `rounded-lg border border-border`.

**Gallery:** Grid of file thumbnails. File name below each, truncated. `text-xs text-muted-foreground`.

**File viewer:** Full-height file display. Back button + grid icon in shell header. File name as shell title.

**Navigation:** Back arrow returns to gallery. Grid icon shows all files. Transitions between views.

---

### 5i. Investigation

**Goal:** Explain automation run status and enable resolution.

**States:** Loading → Not found | Ready

**Not found:** "Run not found" message.

**Ready — scrollable sections:**
1. Status header: icon (spinner if running, checkmark if succeeded, X if failed) + status text
2. Automation link (external)
3. Error box (conditional): `border border-destructive/20 bg-destructive/5 p-3 rounded-md`
4. Trigger context: name, provider, event data
5. Assigned to: name or "Unassigned" + Claim button
6. Timeline: chronological events with timestamps
7. Resolution (conditional): "Mark Succeeded" / "Mark Failed" + optional comment + Confirm

---

## 6. Transitions

- Panel switching: `opacity 0→1`, `y 6→0`, 150ms ease-out enter; `opacity 1→0`, 100ms ease-in exit. `AnimatePresence mode="wait"`.
- No internal entrance animations on first render.

---

## 7. Mobile

- Right panel takes full screen. Chat and panel are mutually exclusive.
- Toggle in session header switches between chat and panel.
- Tab bar is horizontally scrollable.
- Same states and interactions as desktop.
- Closing panel returns to chat.

---

## 8. Keyboard

- `Esc`: exit preview fullscreen; close panel if focused.
- Tab shortcuts may be added later.

---

## 9. Current Gaps

- Preview readiness detection is slow and unreliable (CORS issue).
- Code startup failures lack actionable diagnostics.
- Terminal reconnect has no escalation after repeated failures.
- Services panel doesn't support viewing multiple service logs at once.
- Env panel UI doesn't match the clean, row-based style of the rest of the product.
- Settings uses sub-tabs unnecessarily.
- Git panel has a Changes sub-tab that could be merged into the main view.
- No error boundary isolating panel crashes.
- Inconsistent polling patterns across panels.
