import { useCallback, useEffect, useState } from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { MainSidebar } from "#product/components/workspace/shell/sidebar/MainSidebar";
import { WorkspaceSidebarHeaderControls } from "#product/components/workspace/shell/sidebar/WorkspaceSidebarHeaderControls";

interface WorkspaceShellSidebarProps {
  open: boolean;
  width: number;
  edgeClassName?: string;
  onToggleSidebar: () => void;
}

export function WorkspaceShellSidebar({
  open,
  width,
  edgeClassName = "",
  onToggleSidebar,
}: WorkspaceShellSidebarProps) {
  // Hover peek only exists while the sidebar is collapsed, and it is pointer
  // state, not preference state: nothing about it is persisted, and toggling the
  // sidebar open discards it.
  const [peekActive, setPeekActive] = useState(false);
  const activatePeek = useCallback(() => setPeekActive(true), []);
  const deactivatePeek = useCallback(() => setPeekActive(false), []);
  useEffect(() => {
    // Opening the sidebar disarms any peek, so re-collapsing later starts from
    // hidden instead of inheriting a hover that ended while the sidebar was open
    // (the collapsed panel gets no `mouseleave` in that case).
    if (open) {
      setPeekActive(false);
    }
  }, [open]);

  const body = (
    <DebugProfiler id="workspace-sidebar-frame">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
          <WorkspaceSidebarHeaderControls
            className="pl-[82px]"
            toggleTitle="Hide sidebar"
            iconTone="sidebar"
            onToggleSidebar={onToggleSidebar}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <MainSidebar />
        </div>
      </div>
    </DebugProfiler>
  );

  // The sidebar is split into two elements on purpose, and both are always
  // rendered so the sidebar contents never unmount (a remount would throw away
  // list scroll position every time the sidebar is toggled):
  //
  //  - an in-flow spacer that owns the LAYOUT width and animates it, so an
  //    explicit toggle still slides the content pane across as before;
  //  - the sidebar panel itself, absolutely positioned at its full width, so it
  //    is painted independently of whatever the spacer currently reserves.
  //
  // Collapsed, the spacer reserves nothing and the panel becomes a hover
  // overlay: peeking cannot reflow anything to its right, which is the entire
  // reason the panel does not animate its own width.
  return (
    <div
      // isolate: the resize separator's hit strip overlaps this edge (z-10 in
      // the page context); a local stacking context keeps sidebar-internal
      // z-indexes from painting over the dragger. Collapsed, the sidebar must
      // instead paint OVER the content beside it, so it rises to the overlay
      // layer rather than isolating.
      className={`relative shrink-0 transition-[width] duration-panel ease-standard ${
        // Open, the spacer clips the panel to the width it currently reserves,
        // so toggling still reads as the sidebar sliding out of its own edge.
        // Collapsed it must not clip at all, or a zero-width spacer would erase
        // the overlay it is supposed to let hang over the content.
        open ? "isolate overflow-hidden" : "pointer-events-none z-overlay"
      }`}
      style={{ width: open ? width : 0 }}
    >
      <div
        id="main-sidebar"
        // While hidden the panel must not trap the pointer or the focus ring:
        // no pointer events, and `inert` keeps every control inside out of the
        // tab order and the accessibility tree. Reduced motion needs no branch
        // here — the generated stylesheet zeroes the interaction durations
        // under `prefers-reduced-motion`, so the peek snaps instead of fading.
        className={`absolute inset-y-0 left-0 flex flex-col overflow-hidden bg-sidebar transition-opacity ${
          open
            ? `pointer-events-auto opacity-100 duration-enter ${edgeClassName}`
            : peekActive
              ? "pointer-events-auto opacity-100 shadow-popover border-r border-border duration-enter ease-out-quint"
              : "pointer-events-none opacity-0 duration-exit ease-standard"
        }`}
        style={{ width }}
        inert={!open && !peekActive}
        data-sidebar-peek={open ? "inactive" : peekActive ? "open" : "closed"}
        onMouseEnter={open ? undefined : activatePeek}
        onMouseLeave={open ? undefined : deactivatePeek}
      >
        {body}
      </div>
      {/* Narrow edge target that arms the peek, rendered last so it cannot be
          clipped by the panel and so toggling it inert never reorders the panel
          above it. It stops accepting the pointer as soon as the panel is up,
          otherwise it would swallow clicks along the panel's own left edge. */}
      <div
        className={`absolute inset-y-0 left-0 w-2 ${
          open || peekActive ? "pointer-events-none" : "pointer-events-auto"
        }`}
        data-sidebar-peek-trigger
        onMouseEnter={activatePeek}
        // Leaving the strip outward (back past the window edge) closes the
        // peek. Moving inward hands off to the panel, whose own `onMouseEnter`
        // re-arms in the same batch, so the crossing never flickers.
        onMouseLeave={deactivatePeek}
      />
    </div>
  );
}
