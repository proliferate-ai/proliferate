# Right Sidebar Audit

Complete inventory of the right sidebar in the chat interface — every panel, layout, state management, and known issues.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Header (h-12, border-b)                                          │
│  ┌───────────────── flex-[35] ──┬──────── flex-[65] ────────────┐│
│  │ ← Logo Title SessionHeader   │ Panel Tab Buttons + ⋯ Popover ││
│  └──────────────────────────────┴───────────────────────────────┘│
│  ┌───────────────── flex-[35] ──┬──────── flex-[65] ────────────┐│
│  │                              │  ┌─ rounded-xl border ──────┐ ││
│  │   Chat Thread                │  │                          │ ││
│  │   + Composer                 │  │    RightPanel             │ ││
│  │                              │  │    (panel content here)   │ ││
│  │                              │  │                          │ ││
│  │                              │  └──────────────────────────┘ ││
│  └──────────────────────────────┴───────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `components/coding-session/coding-session.tsx` | Main two-pane layout, header, panel tab picker |
| `components/coding-session/right-panel.tsx` | Panel router — switches between panels based on mode |
| `stores/preview-panel.ts` | Zustand store — all panel state (active mode, mobile view, pinned tabs) |
| `components/coding-session/session-header.tsx` | Mobile toggle button (chat ↔ preview) |

All paths relative to `apps/web/src/`.

---

## Current Layout & Sizing

**No resize/drag exists.** The layout uses fixed CSS flex ratios:

- Chat: `md:flex-[35]` (35%)
- Right panel: `md:flex-[65]` (65%)
- Split is in `coding-session.tsx:306-333`
- The right panel container has `p-2 gap-1` padding and the inner panel has `rounded-xl border border-border bg-background overflow-hidden`
- Header uses the same 35/65 split so tabs align: `md:flex-[35]` / `md:flex-[65]`

**Responsive behavior:**

- `md:` breakpoint (768px) — below this, chat and panel are mutually exclusive via `mobileView` state
- Mobile: full-width toggle between chat and panel (no split view)

---

## State Management (`stores/preview-panel.ts`)

```ts
type PreviewMode =
  | { type: "none" }
  | { type: "url"; url: string | null }
  | { type: "file"; file: VerificationFile }
  | { type: "gallery"; files: VerificationFile[] }
  | { type: "settings"; tab?: "info" | "snapshots" | "auto-start" }
  | { type: "git"; tab?: "git" | "changes" }
  | { type: "terminal" }
  | { type: "vscode" }
  | { type: "artifacts" }
  | { type: "services" }
  | { type: "environment" };
```

- **Default mode**: `{ type: "vscode" }` — Code panel opens by default
- **Pinned tabs**: `["url", "vscode"]` by default — shown in header bar
- **Toggle behavior**: clicking active tab toggles back to default (vscode), not to "none"
- **`missingEnvKeyCount`**: used to show a badge on the Env tab
- **Mobile**: `mobileView: "chat" | "preview"` — full-screen toggle

---

## Panel Tab System (`coding-session.tsx:38-47, 224-303`)

8 tabs defined in `PANEL_TABS`:

| Tab | Type | Icon | Label |
|-----|------|------|-------|
| Preview | `url` | Globe | Preview |
| Code | `vscode` | Code | Code |
| Terminal | `terminal` | SquareTerminal | Terminal |
| Git | `git` | GitBranch | Git |
| Services | `services` | Layers | Services |
| Artifacts | `artifacts` | Zap | Artifacts |
| Env | `environment` | KeyRound | Env |
| Settings | `settings` | Settings | Settings |

- Pinned tabs render as buttons in the header; unpinned ones live in the `⋯` popover
- Each tab in the popover has a pin/unpin toggle
- Labels are hidden below `lg:` breakpoint (only icons show)
- Env tab shows a destructive badge when `missingEnvKeyCount > 0`

---

## Panel-by-Panel Inventory

### 1. Preview Panel

**File:** `preview-panel.tsx`

**What it does:** Renders an iframe of the session's dev server preview URL.

**Structure:**

- Toolbar: back (mobile), refresh, URL display, fullscreen toggle, open-in-new-tab
- Content: polling mechanism (5 attempts, 3s interval) checks if URL is reachable, then renders iframe
- States: `checking` (spinner), `ready` (iframe), `unavailable` (retry button)
- Fullscreen: toggles `fixed inset-0 z-50`

**Issues:**

- No address bar editing — just displays the URL as text
- Fullscreen exit is only via the minimize button (no Esc key handler)
- Polling is somewhat naive (5 attempts max, then gives up permanently until manual retry)

---

### 2. VS Code Panel

**File:** `vscode-panel.tsx`

**What it does:** Launches openvscode-server inside the sandbox and embeds it in an iframe.

**Structure:**

- Checks if openvscode-server is already running via `/api/services`
- If not, starts it with a POST, then polls every 1s (max 30 attempts)
- Once ready, renders iframe pointing to the VS Code URL
- States: `starting` (spinner), `ready` (iframe), `error` (retry button)

**Issues:**

- No header/toolbar at all — just the iframe
- `onClose` prop received but never used (dead prop)
- 30-second timeout with no progress indicator

---

### 3. Terminal Panel

**File:** `terminal-panel.tsx`

**What it does:** Full xterm.js terminal connected via WebSocket to the sandbox.

**Structure:**

- Creates xterm Terminal with FitAddon
- WebSocket connection to `ws://.../proxy/{sessionId}/{token}/devtools/terminal`
- ResizeObserver handles fit-to-container
- Theme reads CSS custom properties for bg/fg

**Issues:**

- `onClose` prop received but never used (dead prop)
- No reconnection logic — if WS closes, shows "closed" status but has no retry
- Status indicator (`connecting`/`connected`/`error`/`closed`) exists in state but is never rendered visually
- No toolbar/header at all

---

### 4. Git Panel

**File:** `git-panel.tsx` + `changes-panel.tsx`

**What it does:** Full git workflow — branch management, commit, push, create PR.

**Structure:**

- Header with close button
- Two internal tabs: "Git" and "Changes"
- Git tab: StatusIndicators, BranchSection (with create-branch), ChangesSection, CommitSection, PushSection, PrSection, CommitsSection
- Changes tab: renders `ChangesContent` (from `changes-panel.tsx`) — file list with diff viewer
- Polls git status every 5 seconds

**Sub-panels in `changes-panel.tsx`:**

- Multi-repo selector
- File list with status indicators (M/A/D/?)
- Inline diff viewer with syntax coloring

**Issues:**

- `ChangesPanel` (standalone) and `ChangesContent` (embedded) are heavily duplicated — same logic copied twice in the same file (~200 lines each)

---

### 5. Services Panel

**File:** `services-panel.tsx` + `service-log-viewer.tsx`

**What it does:** Lists running services with start/stop/restart controls and log viewing.

**Structure:**

- Header: title + refresh button (or back + service name when viewing logs)
- Service rows: StatusDot, name (clickable for logs), uptime, stop/restart buttons
- Sub-view: `ServiceLogViewer` (xterm-based SSE log viewer)
- Footer: expose-port input + service count
- Detail view uses `service-log-viewer.tsx` — another xterm instance, read-only, streaming SSE

**Issues:**

- No close button — the panel has no `onClose` prop or X button in its header
- Port expose UX is somewhat hidden in the footer

---

### 6. Artifacts Panel

**File:** `artifacts-panel.tsx` + `actions-panel.tsx` + `file-viewer.tsx` + `verification-gallery.tsx`

**What it does:** Shows action invocations and verification files (screenshots, videos, logs).

**Structure:**

- Header with back navigation (gallery → file) and close button
- Three sub-views:
  - Default: `ActionsContent` — action invocation cards with approve/deny
  - Gallery: `VerificationGallery` — grid of images/videos/text tiles grouped by type
  - File: `FileViewer` — full viewer for images (zoom/rotate), video, PDF, markdown, text, generic

**Issues:**

- The "Artifacts" name is confusing — it's really Actions + Verification Evidence
- `ActionsPanel` (standalone) duplicates `ActionsContent` (embedded) — same approve/deny logic repeated (~140 lines each)

---

### 7. Environment Panel

**File:** `environment-panel.tsx`

**What it does:** Manage environment variables/secrets for the session.

**Structure:**

- Header with close button
- Always-visible add form (KEY + VALUE + Add button)
- Status summary for spec keys
- Missing required keys section with inline "Set" editing
- All stored variables with delete buttons
- Encrypted badge per variable

**Issues:**

- No search/filter for large variable lists
- The "Add" form injects to both live sandbox AND persists to DB — could be confusing if user wants ephemeral-only

---

### 8. Settings Panel

**File:** `settings-panel.tsx` + `session-info-panel.tsx` + `snapshots-panel.tsx` + `auto-start-panel.tsx`

**What it does:** Session metadata and configuration, organized in tabs.

**Structure:**

- Header with close button
- Three internal tabs: Info, Snapshots, Auto-start

**Info** (`session-info-panel.tsx`):
- Status (running/closed), started time, users, repo/branch/snapshot info
- Links to Env panel, theme toggle

**Snapshots** (`snapshots-panel.tsx`):
- Save snapshot button, current snapshot ID, auto-start hint link

**Auto-start** (`auto-start-panel.tsx`):
- CRUD for service commands that run on session start
- Test-run functionality with results display

**Issues:**

- Info tab has duplicate concerns — it shows environment info that overlaps with the Env panel
- `SessionInfoPanel`, `SnapshotsPanel`, `AutoStartPanel` standalone components exist as dead code (only `*Content` variants are used)

---

## Cross-Cutting Issues

### 1. No resize/drag

Fixed 35/65 flex split with no way to adjust. This is the primary thing to redesign.

### 2. Inconsistent close buttons

Some panels have close (X) buttons in their headers (Git, Artifacts, Environment, Settings), others don't (Services, Terminal, VS Code, Preview on desktop). Close behavior is inconsistent — some close to default view, some close to "none".

### 3. Dead `onClose` props

Terminal and VS Code receive `onClose` but never wire it to any UI element.

### 4. Massive code duplication

- `changes-panel.tsx`: `ChangesPanel` and `ChangesContent` are nearly identical (~200 lines each)
- `actions-panel.tsx`: `ActionsPanel` and `ActionsContent` are nearly identical (~140 lines each)
- `session-info-panel.tsx`, `snapshots-panel.tsx`, `auto-start-panel.tsx` each have standalone `*Panel` components that are dead code (only `*Content` variants are used)

### 5. No shared panel shell/wrapper

Every panel independently implements its own `flex flex-col h-full` wrapper + header bar pattern. There's no `PanelShell` component.

### 6. Header styles inconsistent

Most panels use `px-3 py-2 border-b bg-muted/30`, but the standalone panels (SessionInfoPanel, SnapshotsPanel) use `px-4 py-2.5 border-b` with no bg tint.

### 7. No panel animation

Switching between panels is an instant swap — no transition or animation.

### 8. Tab persistence

Pinned tabs are stored in Zustand memory only (not persisted to localStorage), so they reset on page reload. The dashboard store uses `persist` middleware but the preview panel store does not.
