# Custom Code Editor (Replace OpenVSCode iframe)

Replace the embedded OpenVSCode Server iframe with a custom-skinned Monaco editor that matches our design system, similar to how Lovable handles their code panel.

---

## Current State

- **Technology:** OpenVSCode Server (Gitpod) running inside the sandbox at `localhost:3901`
- **Embedding:** `<iframe>` in `apps/web/src/components/coding-session/vscode-panel.tsx`
- **Proxy chain:** Browser iframe → Gateway HTTP/WS proxy (`/proxy/:sessionId/:token/devtools/vscode/*`) → Sandbox Caddy → openvscode-server
- **Startup:** VscodePanel calls sandbox service manager to start openvscode-server on demand, polls until running
- **File access:** All handled internally by openvscode-server (direct filesystem in sandbox)
- **Terminal:** Separate component (`TerminalPanel`) — already decoupled from the editor

---

## Goal

A lightweight, branded code viewer/editor that:
- Shows files the agent modified (with syntax highlighting)
- Supports a file tree sidebar
- Supports tabbed open files
- Supports inline diffs (agent changes)
- Allows quick user edits
- Matches our design system (dark mode, monochrome tokens)
- Does NOT need full IDE features (no extensions, no debugger, no git integration in-editor)

---

## Architecture

```
Browser (Monaco component)
    ↓↑ HTTP (REST)
Gateway File I/O API (/api/sessions/:id/files/*)
    ↓↑ HTTP (Bearer token)
Sandbox MCP Service Manager (/api/files/*)
    ↓↑ Direct filesystem
/home/user/workspace
```

---

## Work Breakdown

### Phase 1: Sandbox File I/O API

Build REST endpoints on the sandbox's MCP service manager so the browser can read/write files without openvscode-server.

**1.1 — Add file endpoints to sandbox service manager**

The sandbox already has an HTTP server (MCP service manager) at `localhost:3900`. Add:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/files/tree` | GET | Return directory tree (recursive, with metadata: name, path, type, size) |
| `/api/files/read` | POST | Read file contents by path. Body: `{ path: string }`. Return: `{ content: string, language: string }` |
| `/api/files/write` | POST | Write file contents. Body: `{ path: string, content: string }` |
| `/api/files/stat` | POST | Get file metadata (size, modified time, type) |

Relevant files:
- Sandbox service manager lives in the OpenCode plugin/MCP server
- See `packages/shared/src/sandbox/config.ts` for the Caddy routing setup
- Existing `readFiles` in providers (`packages/shared/src/providers/modal-libmodal.ts:1887`) already reads files — can inform the approach

**1.2 — Add gateway proxy routes for file I/O**

Proxy file requests from the browser through the gateway (same auth pattern as existing devtools proxy).

| Gateway route | Proxied to |
|--------------|------------|
| `POST /proxy/:sessionId/:token/devtools/mcp/api/files/tree` | sandbox `/api/files/tree` |
| `POST /proxy/:sessionId/:token/devtools/mcp/api/files/read` | sandbox `/api/files/read` |
| `POST /proxy/:sessionId/:token/devtools/mcp/api/files/write` | sandbox `/api/files/write` |

The existing MCP proxy at `apps/gateway/src/api/proxy/vscode.ts` already handles `/proxy/:sessionId/:token/devtools/mcp/*` routing — the new endpoints should work through the same proxy with no gateway changes needed. Verify this.

**1.3 — File watcher (WebSocket or polling)**

Two options:
- **Option A (simple):** Poll `/api/files/tree` every 2-3 seconds when the editor tab is active. Compare hashes to detect changes. Good enough for v1.
- **Option B (better):** Add a WebSocket endpoint on the sandbox that emits file change events (using `fs.watch` / `chokidar`). Browser subscribes to get real-time updates when the agent modifies files.

Recommend: Start with Option A (polling), upgrade to B later.

---

### Phase 2: Monaco Editor Component

Replace the iframe with a React component using `@monaco-editor/react`.

**2.1 — Install Monaco**

```bash
pnpm -C apps/web add @monaco-editor/react monaco-editor
```

License: MIT — compatible.

**2.2 — Build `CodeEditor` component**

New file: `apps/web/src/components/coding-session/code-editor.tsx`

Structure:
```
┌──────────────────────────────────────────┐
│ Tab bar (open files)                      │
├────────────┬─────────────────────────────┤
│ File tree  │ Monaco editor               │
│ sidebar    │ (syntax highlighted,         │
│            │  read/write, diff mode)      │
│            │                              │
└────────────┴─────────────────────────────┘
```

Sub-components:
- `FileTree` — recursive tree with expand/collapse, file icons by extension, click to open
- `EditorTabs` — horizontal tab bar for open files, close buttons, active indicator
- `MonacoEditor` — the actual editor instance with our theme

**2.3 — Custom Monaco theme**

Create a dark theme matching our design tokens:
- Background: `hsl(0 0% 4%)` (our `--background` dark)
- Foreground: `hsl(0 0% 98%)` (our `--foreground` dark)
- Selection: `hsl(0 0% 15%)` (our `--accent` dark)
- Line numbers: `hsl(0 0% 45%)` (our `--muted-foreground` dark)
- Current line highlight: `hsl(0 0% 8%)`
- No minimap (keep it clean like Lovable)

**2.4 — File I/O hooks**

New hooks in `apps/web/src/hooks/`:
- `use-file-tree.ts` — fetches and caches directory tree, handles polling/refresh
- `use-file-content.ts` — reads file content on demand, caches open files
- `use-file-save.ts` — writes file content back to sandbox

All go through the gateway proxy using the session token from `useWsToken()`.

**2.5 — Diff view**

Monaco has built-in diff editor support (`MonacoDiffEditor`). When the agent modifies a file:
- Store the "before" version (from the last user-seen state)
- Show inline diff highlighting (green/red gutters)
- User can toggle between "diff" and "edit" mode

---

### Phase 3: Integration & Swap

**3.1 — Replace VscodePanel usage**

In `apps/web/src/components/coding-session/right-panel.tsx`, swap:
```tsx
// Before
if (mode.type === "vscode" && sessionProps?.sessionId) {
  return <VscodePanel sessionId={sessionProps.sessionId} onClose={handleClose} />;
}

// After
if (mode.type === "vscode" && sessionProps?.sessionId) {
  return <CodeEditor sessionId={sessionProps.sessionId} onClose={handleClose} />;
}
```

**3.2 — Remove openvscode-server startup**

- Delete the service manager calls that start openvscode-server
- The `VscodePanel` component can be deleted entirely once `CodeEditor` is stable
- Keep the gateway vscode proxy routes for now (backward compat) but they become unused

**3.3 — Open files from chat**

When the agent mentions a file in chat or modifies one, the editor should auto-open it:
- Emit an event from the chat thread (e.g., `openFile(path)`)
- `CodeEditor` listens and opens the tab + scrolls to relevant line
- This is how Lovable does it — files "pop open" as the agent works

**3.4 — Wire up to preview panel store**

The `usePreviewPanelStore` already has a `mode.type === "file"` case. Connect it so clicking a file reference in chat opens the editor to that file.

---

### Phase 4: Cleanup & Optimization

**4.1 — Remove openvscode-server from sandbox image**

In `packages/modal-sandbox/Dockerfile`:
- Remove the openvscode-server installation (~150MB savings)
- Remove the Caddy route for `/_proliferate/vscode/*`
- This is a breaking change — only do it after the new editor is stable and shipped

**4.2 — Remove gateway vscode proxy**

Delete `apps/gateway/src/api/proxy/vscode.ts` (the HTTP + WS proxy for openvscode-server). The file I/O goes through the existing MCP proxy instead.

**4.3 — Lazy-load Monaco**

Monaco is ~2MB. Use `next/dynamic` to lazy-load the editor component so it doesn't affect initial page load:
```tsx
const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
```

---

## Key Files

| File | Role |
|------|------|
| `apps/web/src/components/coding-session/vscode-panel.tsx` | Current iframe editor (to be replaced) |
| `apps/web/src/components/coding-session/right-panel.tsx` | Panel router — swap VscodePanel for CodeEditor here |
| `apps/gateway/src/api/proxy/vscode.ts` | Gateway proxy for openvscode (eventually removable) |
| `packages/shared/src/sandbox/config.ts` | Caddy config / sandbox routing |
| `packages/shared/src/providers/modal-libmodal.ts` | Existing `readFiles` implementation |
| `packages/modal-sandbox/Dockerfile` | openvscode-server installation (Phase 4 removal) |
| `apps/web/src/stores/preview-panel.ts` | Panel mode store (already has "file" mode) |

---

## Risks & Open Questions

1. **Monaco bundle size** — ~2MB gzipped. Lazy loading mitigates this. Could also use CodeMirror (~200KB) but Monaco has better TypeScript/JSX support and built-in diff.
2. **File watcher latency** — Polling at 2-3s means the file tree may lag behind agent changes. Acceptable for v1; WebSocket watcher for v2.
3. **Large files** — Monaco handles files up to ~10MB well. For larger files, show a "file too large" placeholder.
4. **Binary files** — Images, PDFs etc. should show a preview or "binary file" message, not load in Monaco.
5. **Concurrent edits** — If the user edits a file while the agent is also editing it, we need conflict resolution. Simplest: agent changes always win, user sees a "file changed externally" banner with option to reload.
6. **No LSP / intellisense** — This is intentional for v1. The agent does the coding; the user mostly reviews. If we want intellisense later, it's a separate project (run LSP server in sandbox + WebSocket bridge).

---

## Estimated Effort

| Phase | Effort | Can ship independently? |
|-------|--------|------------------------|
| Phase 1: File I/O API | 2-3 days | Yes (enables other features too) |
| Phase 2: Monaco component | 4-5 days | Yes (with Phase 1) |
| Phase 3: Integration | 2-3 days | Yes (the actual swap) |
| Phase 4: Cleanup | 1 day | Yes (after stable rollout) |
| **Total** | **~2 weeks** | |
