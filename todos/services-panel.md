# Services Panel — Current State & Context

> Standalone spec for the "Services" tab in the workspace right panel. Written for someone with no codebase access.

---

## 1. What It Is

The Services panel is a tab in the workspace's right-side panel (alongside Preview, Code, Terminal, Git, Artifacts, Settings). It shows the background processes running inside the user's cloud sandbox — things like dev servers (`npm run dev`), database processes, or any long-running command the coding agent started.

Think of it as a lightweight process manager / task manager for the sandbox environment.

**What you can do today:**
- See all running/stopped/errored services with their command and status
- Click a service name to stream its logs in real time
- Stop a running service
- Restart a stopped/errored service
- Expose a port from the sandbox to the public internet (for previewing web apps)

---

## 2. Architecture & Data Flow

```
Browser (ServicesPanel component)
    │
    │ HTTP GET every 5s (polling)
    ▼
Gateway proxy (/proxy/:sessionId/:token/devtools/mcp/api/services)
    │
    │ HTTP (forwarded with Bearer token)
    ▼
Sandbox MCP Service Manager (localhost:3900/api/services)
    │
    │ Direct process management (spawn, kill, read log files)
    ▼
/home/user/workspace (sandbox filesystem)
```

**Key points:**

- **No WebSocket for service data.** Unlike the chat stream, services uses plain HTTP polling every 5 seconds.
- **Logs use SSE (Server-Sent Events).** When you click a service name, the browser opens an `EventSource` to `GET /api/logs/:name`. The sandbox streams log file contents: first an `initial` event with the full log, then `append` events as new lines appear.
- **Actions (stop/restart/expose) are fire-and-forget HTTP calls.** Stop = `DELETE /api/services/:name`. Restart = `POST /api/services` with the same name/command/cwd. Expose = `POST /api/expose` with a port number.
- **Auth is token-based.** The WebSocket token (same one used for the chat connection) is embedded in the URL path: `/proxy/:sessionId/:token/devtools/mcp/...`. The gateway validates it and proxies to the sandbox.
- **No TanStack Query, no oRPC.** The entire data layer is raw `fetch()` and `useState` in a custom hook. This is an outlier — every other data-fetching surface in the app uses TanStack Query + oRPC.

---

## 3. Data Model

```typescript
interface ServiceInfo {
  name: string;       // e.g. "dev-server", "postgres"
  command: string;    // e.g. "npm run dev", "pg_ctl start"
  cwd: string;        // working directory, e.g. "/home/user/workspace"
  pid: number;        // OS process ID in the sandbox
  status: "running" | "stopped" | "error";
  startedAt: number;  // Unix timestamp (ms)
  logFile: string;    // Path to the log file in the sandbox
}
```

The service list response also includes `exposedPort: number | null` — which port (if any) is currently forwarded to the public internet.

---

## 4. File Map

| File | What it does |
|------|-------------|
| `apps/web/src/components/coding-session/services-panel.tsx` | The UI component — header, service rows, log viewer, port exposure form |
| `apps/web/src/components/coding-session/runtime/use-services.ts` | The data hook — polling, SSE logs, stop/restart/expose actions |
| `apps/web/src/components/coding-session/runtime/use-ws-token.ts` | Provides the auth token used in proxy URLs |
| `apps/web/src/components/coding-session/right-panel.tsx` | Panel router — dynamically imports ServicesPanel when `mode.type === "services"` |
| `apps/web/src/components/coding-session/coding-session.tsx` | Defines `PANEL_TABS` array (Services = `{ type: "services", icon: Layers }`) |
| `apps/web/src/stores/preview-panel.ts` | Zustand store managing which panel tab is active, pin/unpin state |

The sandbox-side service manager that responds to these API calls lives in the sandbox image (not in this web codebase). The gateway proxy that forwards requests is at `apps/gateway/src/api/proxy/`.

---

## 5. UI Design — Current State

### Layout

```
┌─────────────────────────────────────────┐
│ Header bar                              │
│  [← Back]  "Services"  port 3000   [↻][✕]│
├─────────────────────────────────────────┤
│                                         │
│  ● dev-server                           │
│    npm run dev                    [■][↻]│
│  ─────────────────────────────────────  │
│  ● postgres                             │
│    pg_ctl start                     [↻] │
│  ─────────────────────────────────────  │
│                                         │
│  Expose port                            │
│  [ 3000       ] [Expose]                │
│                                         │
├─────────────────────────────────────────┤
│ 2 services                              │
└─────────────────────────────────────────┘
```

When you click a service name, it navigates to log view:

```
┌─────────────────────────────────────────┐
│ [←]  "Logs: dev-server"            [✕]  │
├─────────────────────────────────────────┤
│ > Ready on http://localhost:3000        │
│ > Compiled successfully                 │
│ > GET / 200 in 42ms                     │
│ > GET /api/health 200 in 3ms            │
│ ...                                     │
└─────────────────────────────────────────┘
```

### What's right about the UI

- **Uses semantic tokens throughout.** This is actually one of the better-tokenized components in the codebase. No hardcoded colors — status dots use `text-foreground` (running), `text-destructive` (error), `text-muted-foreground` (stopped). Backgrounds use `bg-muted/30`, `bg-muted/50`.
- **Tooltip-wrapped icon buttons.** All action buttons (stop, restart, refresh, close) have tooltips. Consistent with design system.
- **Loading/error/empty states are handled.** Spinner while loading, error text if the API fails, "No services running" for empty state.
- **Log viewer auto-scrolls.** New log lines smoothly scroll into view.
- **Port exposure form is minimal.** Numeric input + button, disabled state while exposing.

### What's wrong about the UI

1. **It looks like a system utility, not a product panel.** The visual treatment is purely functional — no hierarchy, no visual breathing room. The service rows are dense `px-3 py-2` with a simple divide. Compare to the session list elsewhere which has `px-4 py-3`, status badges, time labels, and a polished card treatment. The services panel feels like it belongs in a terminal emulator settings menu, not alongside our polished Preview/Code panels.

2. **Status dots are filled circles (lucide `Circle`), not our `StatusDot` component.** The rest of the app uses `<StatusDot />` from `@/components/ui/status-dot` for status indicators. The services panel rolled its own using `<Circle className="h-2 w-2 fill-current" />` with manual color classes. This creates visual inconsistency — different dot sizes, different rendering, different semantics.

3. **No service metadata.** A running dev server shows its name and command, but not: how long it's been running, what port it's listening on, CPU/memory usage, or restart count. The `startedAt` field exists in the data model but isn't displayed.

4. **Log viewer is a raw `<pre>` tag.** No syntax highlighting, no line numbers, no search, no copy button, no "scroll to bottom" affordance when you've scrolled up. It's `text-xs font-mono p-2 whitespace-pre-wrap break-all` — functional but crude. The terminal panel next door uses xterm.js with proper ANSI color support; the log viewer is plain text.

5. **Port exposure UX is disconnected.** The exposed port is shown as tiny gray text in the header (`port 3000`) but there's no way to: copy the public URL, click to open it, un-expose a port, or see which service is using it. The Preview tab handles URL previewing — there's no cross-linking between "I exposed port 3000 in Services" and "here's the preview URL in the Preview tab."

6. **No indication that polling is happening.** The service list refreshes every 5 seconds but there's no visual feedback. If a service status changes between polls, the user sees a jarring instant flip. No transition, no "updating..." indicator.

7. **The header layout is inconsistent with other panels.** The services panel has its own header bar (`px-3 py-2 border-b bg-muted/30`) with a close button. But the parent `RightPanel` already handles panel switching via the tab bar in the main header. The close button here closes the services panel and falls back to another panel — redundant with clicking a different tab. Other panels (terminal, code) don't have their own close buttons.

8. **"Expose port" section feels tacked on.** It sits below the service list, separated by a `border-t`. Functionally it's unrelated to individual services — it's a sandbox-level operation. It might belong in the Settings panel or as a separate section in the header.

---

## 6. Code Issues

### In `use-services.ts` (the data hook)

1. **Raw `fetch()` instead of TanStack Query.** Every other data-fetching hook in the app uses TanStack Query (via oRPC). This hook manually manages `loading`, `error`, `services` state with `useState` — no caching, no deduplication, no background refetch, no stale-while-revalidate. If you switch away from the Services tab and come back, it starts fresh (flash of loading state).

2. **No abort controllers.** The polling `fetch()` calls don't use `AbortController`. If you navigate away mid-request, the response still arrives and calls `setServices()` on an unmounted component. React may warn or silently leak.

3. **Empty catch blocks swallow errors silently.** The `handleStop`, `handleRestart`, and `handleExpose` callbacks all have `catch {}` with comments like "Refresh to get actual state" or "User can retry." But the user has no idea the action failed — no toast, no error message, nothing.

4. **Log content grows unbounded.** Each `append` SSE event concatenates to `logContent` state. For a long-running service with verbose logging, this string grows without limit. No truncation, no ring buffer, no "older logs hidden" cutoff. In a session running for hours, this will cause the browser tab to slow down and eventually crash.

5. **SSE `onerror` is a no-op.** The comment says "EventSource auto-reconnects; no action needed" — but if the sandbox dies or the token expires, the EventSource will keep retrying forever, hitting 401s or connection refused errors in a tight loop. No exponential backoff, no error surfacing.

6. **Polling continues when the tab isn't visible.** The 5-second `setInterval` runs regardless of whether the Services panel is active. If the user switches to the Terminal tab, the service list is still being polled.

### In `services-panel.tsx` (the UI component)

7. **`ServiceRow` is not memoized.** Every 5-second poll triggers a re-render of all service rows, even if nothing changed. Not a performance issue with 2-3 services, but unnecessary.

8. **No keyboard navigation.** The service list is not navigable with arrow keys. No `role="list"` / `role="listitem"`. The log viewer has no keyboard shortcuts (Ctrl+F to search, Ctrl+C to copy, Ctrl+End to jump to bottom).

---

## 7. How It Compares to Other Panels

| Aspect | Services Panel | Terminal Panel | Preview Panel |
|--------|---------------|---------------|---------------|
| Data fetching | Raw `fetch` + `useState` | xterm.js + WebSocket | iframe src URL |
| Auth | Token in URL path | Token in URL path | Token in URL path |
| Streaming | SSE (EventSource) | WebSocket (xterm attach) | N/A |
| Header | Own close button + refresh | Own close button | Own URL bar |
| Loading state | Spinner | Spinner | Loading bar |
| Error handling | Text message | Reconnect + banner | N/A |
| Design system compliance | Good (semantic tokens) | Good | Good |

The Services panel's biggest gap vs the other panels is in the data layer. Terminal uses a mature library (xterm.js) with proper WebSocket management. Preview is just an iframe. Services hand-rolls everything.

---

## 8. Architectural Directives

The goal is to transform this panel from a "dumb task manager" into a **first-class IDE debugging interface**. A developer cannot efficiently debug a modern web framework if the logs strip ANSI colors, the UI crashes from unbounded string concatenation, and port exposure is entirely disconnected from the Preview pane.

### Directive 1: Kill the `<pre>` tag — mandate `xterm.js` for logs

Debugging a Webpack/Vite/Next.js stack trace in monochrome plain text is physically painful. Modern dev servers rely entirely on red/green/cyan ANSI terminal colors to highlight errors and file paths. Stripping those colors defeats the core purpose of looking at the logs.

**The fix:** We already pay the bundle-size tax for `xterm.js` in the Terminal panel. Reuse it here. When a user clicks a service to view logs, spawn a *read-only* `xterm.js` instance. Feed the SSE log chunks directly into `term.write()`. This instantly gives perfect ANSI color support, native scrolling, and a premium IDE feel.

### Directive 2: Fix the unbounded memory leak (P0)

Do not wait for a redesign. An IDE tab that crashes the browser is a P0 bug. Infinite string concatenation inside a React `useState` for a verbose background process guarantees an OOM crash.

**The fix:** Routing logs through `xterm.js` (Directive 1) solves this automatically — configure `scrollback: 5000`. Xterm natively handles ring-buffer memory management, dropping old lines so the DOM never crashes.

### Directive 3: Burn the hand-rolled data fetching — enforce the platform standard

Hand-rolling a polling mechanism without `AbortControllers` or visibility checks in a complex SPA is a massive liability. It burns gateway resources and leaves developers chasing ghosts when silent errors occur.

**The fix:**
1. Rip out the custom polling logic. Wrap `/api/services` in a standard TanStack Query `useQuery` with `refetchInterval: 5000`.
2. TanStack Query automatically pauses polling when the window/tab loses focus, instantly solving the background CPU-burn issue.
3. Wrap Stop/Restart actions in `useMutation` and fire standard red Toast notifications on `onError`. No more swallowed errors.

### Directive 4: Bridge the "Expose Port" gap — port exposure is a Preview capability

When a developer exposes port 3000, their next immediate thought is "I want to see the web app." Typing "3000" into a random box at the bottom of a list breaks the debugging loop.

**The fix:** Move port exposure directly onto the Service Row. If a service is running and exposes a port, the row must render an explicit, highly visible **`[ Open in Preview ]`** button. Clicking it should:
1. Handle the exposure logic under the hood
2. Instantly switch the right panel tab to "Preview"
3. Load the URL

Tightly couple the process to the visual output. If manual port exposure is still needed for untracked processes, move that generic input box into the header of the Preview panel, not here.

### Directive 5: Conform to the "Engine Room" spec — strip redundant chrome

- **Kill the internal close button.** The parent tab bar controls panel visibility. Nested close buttons confuse the spatial layout.
- **Enforce design tokens.** Swap manual SVG circles for `<StatusDot />`.
- **Add debug context.** Show `startedAt` as relative timestamp: `Uptime: 14m` or `Crashed 2m ago` so the developer instantly knows if their dev server just crash-looped.

---

## 9. Target Layout

The engineer should target this exact visual hierarchy.

**List view:**

```
┌─────────────────────────────────────────────────────────┐
│  Services                                          [↻]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [●] dev-server                      Uptime: 14m        │
│      npm run dev                                        │
│      Port 3000          [ Open in Preview ] [■] [↻]     │
│  ───────────────────────────────────────────────────    │
│  [○] postgres                        Stopped            │
│      pg_ctl start                                       │
│                                            [▶] [↻]      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Log view (xterm.js):**

```
┌─────────────────────────────────────────────────────────┐
│  [← Services]   ● dev-server logs                       │
├─────────────────────────────────────────────────────────┤
│  [xterm.js canvas with ANSI colors]                     │
│  \x1b[32m ✓ Ready in 125ms \x1b[0m                      │
│  \x1b[36m ℹ GET /api/health 200 \x1b[0m                 │
│                                                         │
│  ⨯ Error: Cannot read properties of undefined           │
│     at handleCallback (src/auth.ts:14:22)               │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Implementation Order

| Step | What | Priority | Deps |
|------|------|----------|------|
| 1 | Fix unbounded log memory leak (P0 bug) | Immediate | None |
| 2 | Replace `<pre>` log viewer with read-only `xterm.js` instance | High | Solves step 1 permanently |
| 3 | Migrate `useServices` to TanStack Query (`useQuery` + `useMutation`) | High | None |
| 4 | Add toast notifications on action failure (stop/restart/expose) | High | Step 3 |
| 5 | Replace `Circle` icons with `<StatusDot />`, add `startedAt` relative time | Medium | None |
| 6 | Remove internal close button from header | Medium | None |
| 7 | Move port exposure onto Service Row as "Open in Preview" button | Medium | Needs preview-panel store wiring |
| 8 | Remove standalone "Expose port" form from bottom of panel | Medium | Step 7 |
| 9 | Move generic manual port input to Preview panel header (fallback) | Low | Step 7 |
