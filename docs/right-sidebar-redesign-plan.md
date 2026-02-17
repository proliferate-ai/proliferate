# Right Sidebar Redesign — Implementation Plan

Comprehensive, end-to-end plan to overhaul the Right Sidebar architecture. Systematically addresses every layout constraint, cross-cutting UI issue, dead code fragment, and panel-specific technical debt identified in the audit.

Structured into **5 Execution Phases**, covering both frontend component architecture and backend API alignments.

---

## Phase 1: Draggable & Resizable Layout Engine

Currently, the interface relies on static `md:flex-[35]` / `md:flex-[65]` widths, and the global header is structurally separated from the body. To make the sidebar fluidly resizable with a drag handle that spans the full height of the viewport, we must pivot the DOM structure.

### 1. Structural Refactor

**File:** `apps/web/src/components/coding-session/coding-session.tsx`

**What to Delete:**

- Remove all hardcoded `md:flex-*` classes (`coding-session.tsx:306-333`).
- Delete the monolithic top-level header row (`<div className="flex h-12 border-b">...</div>`) that currently wraps both the chat header and panel tabs.

**What to Create:**

- Install and utilize `react-resizable-panels` (the standard engine behind `shadcn/ui`'s `<ResizablePanelGroup>`).
- Split the global header into two localized headers: `ChatHeader` (Logo, Session Title) goes inside the left pane, and `PanelTabsHeader` (Tab buttons, Popover) goes inside the right pane.

**End Result Implementation:**

```tsx
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "react-resizable-panels";
// Or from "@/components/ui/resizable" if using shadcn

export function CodingSession() {
  const { mobileView, panelSizes, setPanelSizes } = usePreviewPanelStore();

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      {/* Mobile-only full-screen toggle logic remains here */}

      {/* Desktop Resizable Layout */}
      <ResizablePanelGroup
        direction="horizontal"
        className="hidden md:flex h-full w-full"
        onLayout={(sizes) => setPanelSizes(sizes)} // Persist layout preferences
      >

        {/* LEFT PANE: Chat */}
        <ResizablePanel
          defaultSize={panelSizes[0] || 35}
          minSize={25} // Cannot crush chat below 25%
          maxSize={65} // Cannot expand chat beyond 65%
          className="flex flex-col border-r border-border"
        >
          {/* Embedded Left Header */}
          <div className="h-12 border-b flex items-center justify-between px-4 shrink-0 bg-background">
             <div className="flex items-center gap-2"><Logo /> <Title /></div>
             <SessionHeader />
          </div>
          <div className="flex-1 overflow-hidden relative flex flex-col">
            <ChatThread />
            <Composer />
          </div>
        </ResizablePanel>

        {/* FULL-HEIGHT DRAG HANDLE */}
        <ResizableHandle
          withHandle
          className="w-1.5 bg-border hover:bg-primary/50 transition-colors cursor-col-resize z-50"
        />

        {/* RIGHT PANE: Tool Panels */}
        <ResizablePanel
          defaultSize={panelSizes[1] || 65}
          minSize={35} // Cannot shrink panels below 35%
          maxSize={75} // Cannot expand panels beyond 75%
          className="flex flex-col bg-muted/10"
        >
          {/* Embedded Right Header */}
          <div className="h-12 border-b flex items-center px-2 shrink-0 bg-background">
             <PanelTabs /> {/* Renders Pinned Buttons + ⋯ Popover */}
          </div>
          {/* Panel Container */}
          <div className="flex-1 p-2 gap-1 overflow-hidden relative">
            <div className="h-full rounded-xl border border-border bg-background overflow-hidden relative shadow-sm">
              <RightPanelRouter />
            </div>
          </div>
        </ResizablePanel>

      </ResizablePanelGroup>
    </div>
  );
}
```

---

## Phase 2: State Persistence & Routing Transitions

Fix tab persistence (currently memory-only), formalize the "close" behavior, and add smooth transitions for panel swapping.

### 1. Store Overhaul

**File:** `apps/web/src/stores/preview-panel.ts`

**What to Refactor:**

- Wrap the Zustand store in `persist` middleware.
- Use `partialize` to ensure ephemeral data (like `missingEnvKeyCount` or `mobileView`) is **not** saved to `localStorage`, while `pinnedTabs` and `panelSizes` are.
- **Fix Toggle Bug:** Update `toggleTab` so clicking an active tab explicitly sets `mode.type` to `"none"`, rather than defaulting to `"vscode"`.

**End Result Implementation:**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const usePreviewPanelStore = create<PreviewPanelStore>()(
  persist(
    (set, get) => ({
      mode: { type: 'vscode' },
      pinnedTabs: ['url', 'vscode'],
      panelSizes: [35, 65],
      mobileView: 'chat',
      missingEnvKeyCount: 0,

      setPanelSizes: (sizes) => set({ panelSizes: sizes }),

      // Standardize the close action globally
      closePanel: () => set({ mode: { type: 'none' } }),

      toggleTab: (tabType) => {
        const currentType = get().mode.type;
        if (currentType === tabType) {
          set({ mode: { type: 'none' } }); // Fix toggle to close
        } else {
          set({ mode: { type: tabType } });
        }
      }
    }),
    {
      name: 'preview-panel-storage',
      partialize: (state) => ({
        pinnedTabs: state.pinnedTabs,
        panelSizes: state.panelSizes
      }),
    }
  )
);
```

### 2. Panel Animations

**File:** `apps/web/src/components/coding-session/right-panel.tsx`

**What to Refactor:**

- The current `switch (mode.type)` causes an abrupt layout jump.
- Wrap the panel router in Framer Motion to animate changes, and provide a clean empty state.

**End Result Implementation:**

```tsx
import { AnimatePresence, motion } from 'framer-motion';

export function RightPanelRouter() {
  const { mode } = usePreviewPanelStore();

  if (mode.type === 'none') {
    return <EmptyState message="Select a tool from the top bar" />;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode.type}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="h-full w-full"
      >
        {/* switch(mode.type) statement goes here */}
      </motion.div>
    </AnimatePresence>
  );
}
```

---

## Phase 3: The Universal `PanelShell` Component

Every panel currently implements its own flex column wrapper, header, and styling. This is the root cause of missing close buttons, dead `onClose` props, and visual inconsistencies.

### 1. Create the Unified Wrapper

**File:** `apps/web/src/components/coding-session/panel-shell.tsx`

**What to Create:**

A strict layout wrapper component that all 8 panels must consume. It standardizes the header padding, injects the global close function, and provides an injection slot (`actions`) for toolbars.

**End Result Implementation:**

```tsx
import { X } from "lucide-react";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { Button } from "@/components/ui/button";

interface PanelShellProps {
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode; // Toolbars, search inputs, badges
  noPadding?: boolean;       // For edge-to-edge iframes (VS Code, Terminal)
  children: React.ReactNode;
}

export function PanelShell({ title, icon, actions, noPadding, children }: PanelShellProps) {
  const closePanel = usePreviewPanelStore(s => s.closePanel);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden relative">
      {/* Universal Standardized Header */}
      <div className="h-10 px-3 py-2 border-b border-border bg-muted/30 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon} <span>{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <div className="w-[1px] h-4 bg-border mx-1" /> {/* Vertical Divider */}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={closePanel}>
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Standardized Content Container */}
      <div className={cn("flex-1 overflow-y-auto relative", !noPadding && "p-4")}>
        {children}
      </div>
    </div>
  );
}
```

---

## Phase 4: Panel-by-Panel Refactoring & Deletion Plan

Every panel will now be wrapped in `<PanelShell>` and have its individual technical debt eradicated.

### 1. Preview Panel (`preview-panel.tsx`)

- **Refactor:** Wrap the iframe in `<PanelShell title="Preview" noPadding actions={<Toolbar/>} />`.
- **UX Fix (Address Bar):** Replace the static `<span>{url}</span>` with a read-only `<input value={url} readOnly className="h-6 px-2 text-xs font-mono bg-muted rounded w-48 truncate" />` so users can easily copy the active URL.
- **UX Fix (Esc Key):** Add a `useEffect` to the Fullscreen mode: `const handleEsc = (e) => e.key === 'Escape' && setFullscreen(false); window.addEventListener('keydown', handleEsc);`
- **Logic Fix (Polling):** The naive 5-attempt limit is flawed. Create an exponential backoff hook (e.g., 2s, 4s, 8s, up to a max of 30 attempts). If it times out, render an explicit "Dev server is unreachable. [Retry Now]" UI block instead of a permanent empty state.

### 2. VS Code Panel (`vscode-panel.tsx`)

- **Refactor:** Wrap in `<PanelShell title="Code Editor" noPadding />`. (This instantly resolves the missing header and dead `onClose` prop audit findings).
- **UX Fix (30s Timeout):** Replace the static infinite spinner. Track an `attemptCount` state for the 1-second interval. Render a visual `<Progress value={(attemptCount / 30) * 100} />` to visually indicate the polling runway to the user.

### 3. Terminal Panel (`terminal-panel.tsx`)

- **Refactor:** Wrap in `<PanelShell title="Terminal" noPadding actions={<TerminalStatus />} />`. (Resolves dead `onClose` and missing header).
- **UX Fix (Status UI):** Consume the currently unused `connecting`/`connected`/`error`/`closed` state. Create a small `<TerminalStatus />` component to pass to the shell's `actions`: `<div className={cn("w-2 h-2 rounded-full", state === 'connected' ? "bg-green-500" : "bg-red-500")} />`.
- **Logic Fix (Auto-Reconnect):** In the xterm WebSocket initialization, attach an `onclose` handler: `ws.onclose = () => { setStatus('connecting'); setTimeout(initTerminal, 3000); }` to gracefully recover from network drops.

### 4. Git Panel (`git-panel.tsx` & `changes-panel.tsx`)

- **Refactor:** Wrap `git-panel.tsx` in `<PanelShell title="Source Control">`.
- **DELETE MASSIVE DUPLICATION:** Open `changes-panel.tsx`. **Delete the entire `ChangesPanel` standalone component** (~200 lines). Keep only `ChangesContent`, rename it to `ChangesView`, and update imports in `git-panel.tsx` to render `<ChangesView />` directly.

### 5. Services Panel (`services-panel.tsx` & `service-log-viewer.tsx`)

- **Refactor:** Wrap in `<PanelShell title="Services">`. (This injects the missing close button automatically).
- **UX Fix (Port Expose):** Move the "Expose Port" input out of the hidden footer. Pass it directly into the `<PanelShell actions={...}>` slot, or render it as a distinct block at the very top of the panel body.

### 6. Artifacts Panel (`artifacts-panel.tsx` & `actions-panel.tsx`)

- **Rename:** In `PANEL_TABS` inside `coding-session.tsx`, rename the label from "Artifacts" to "Evidence & Actions" or "Workspace". The current name breaks user mental models.
- **Refactor:** Wrap `artifacts-panel.tsx` in `<PanelShell title="Evidence & Actions">`.
- **DELETE MASSIVE DUPLICATION:** Open `actions-panel.tsx`. **Delete the entire `ActionsPanel` standalone component** (~140 lines). Keep only `ActionsContent`.

### 7. Environment Panel (`environment-panel.tsx`)

- **Refactor:** Wrap in `<PanelShell title="Environment Variables">`.
- **UX Fix (Search):** Add `const [search, setSearch] = useState('')` and render an `<Input type="search" placeholder="Filter variables..." className="mb-4" />` at the top of the body. Filter the render loop: `vars.filter(v => v.key.includes(search)).map(...)`.
- **UX Fix (Ephemeral State):** Update the "Add Variable" form. Add a switch: `<Switch id="persist" defaultChecked /> <Label>Save to Workspace Database</Label>`. Pass this to the backend API (See Phase 5).

### 8. Settings Panel (`settings-panel.tsx` & children)

- **Refactor:** Wrap `settings-panel.tsx` in `<PanelShell title="Settings">`. (This fixes the inconsistent `px-4 py-2.5` custom padding issue).
- **DELETE DEAD CODE:** Open `session-info-panel.tsx`, `snapshots-panel.tsx`, and `auto-start-panel.tsx`. **Delete the `SessionInfoPanel`, `SnapshotsPanel`, and `AutoStartPanel` wrapper components completely.** They are unused dead code. Export only their `*Content` variants.
- **UX Fix (Overlap):** Open `session-info-content.tsx` and delete the environment variable summary section entirely. It overlaps with the dedicated Env panel and clutters the UI. Add a simple link button routing the user to the Env tab.

---

## Phase 5: Backend API Overhaul

To successfully execute the frontend updates—specifically the ephemeral environment variables and terminal reconnects—the following backend adjustments are required.

### 1. Environment Variables API

**Route:** `POST /api/sessions/:id/environment`

- **Update Required:** The payload schema (Zod/Valibot) must be updated to accept an `ephemeral: boolean` flag (derived from the new toggle in Phase 4.7).

**Controller Logic:**

```typescript
const { key, value, ephemeral = false } = requestBody;

// 1. ALWAYS inject into the live sandbox session via the container/supervisor API
await sandboxManager.injectEnvironmentVariable(sessionId, key, value);

// 2. IF NOT ephemeral, persist it to the database for future sessions
if (!ephemeral) {
  await db.environmentVariable.upsert({
    where: { sessionId_key: { sessionId, key } },
    update: { value: encryptedValue },
    create: { sessionId, key, value: encryptedValue }
  });
}
```

### 2. Terminal WebSocket Proxy Resilience

**Route:** `ws://.../proxy/{sessionId}/{token}/devtools/terminal`

- **Update Required:** To support the new frontend auto-reconnect logic in Phase 4.3, the backend terminal manager must support PTY (pseudo-terminal) session re-attachment.
- **Controller Logic:** When a WebSocket drops, the backend must keep the underlying PTY process alive for a grace period (e.g., 60 seconds). When the frontend's 3-second auto-reconnect fires, the backend must map the connection ID/Token to the *existing* active PTY shell, piping the existing stream to the socket. Spawning a fresh bash process on reconnect will cause the user to lose all terminal history and active running commands.
