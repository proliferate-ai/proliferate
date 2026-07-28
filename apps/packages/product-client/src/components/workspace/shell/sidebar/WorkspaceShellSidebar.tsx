import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "@proliferate/design/motion";
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
  const peekCloseTimerRef = useRef<number | null>(null);

  const cancelPeekClose = useCallback(() => {
    if (peekCloseTimerRef.current !== null) {
      window.clearTimeout(peekCloseTimerRef.current);
      peekCloseTimerRef.current = null;
    }
  }, []);

  const activatePeek = useCallback(() => {
    cancelPeekClose();
    setPeekActive(true);
  }, [cancelPeekClose]);

  // Closing is deferred, opening is not. The pointer leaves the panel for a
  // beat during ordinary use -- crossing the gap to the collapsed header's own
  // toggle, or clipping a corner on the way to it -- and an immediate close
  // turned every one of those into a full fade-out that a click then had to
  // fade back in. One grace period, sized to the hover-card's, absorbs the
  // crossing; a re-entry inside it cancels the close outright, so the panel
  // never animates at all.
  const deactivatePeek = useCallback(() => {
    cancelPeekClose();
    peekCloseTimerRef.current = window.setTimeout(() => {
      peekCloseTimerRef.current = null;
      setPeekActive(false);
    }, motion.delay.hoverCardHideMs);
  }, [cancelPeekClose]);

  useEffect(() => cancelPeekClose, [cancelPeekClose]);

  useEffect(() => {
    // Opening the sidebar disarms any peek, so re-collapsing later starts from
    // hidden instead of inheriting a hover that ended while the sidebar was open
    // (the collapsed panel gets no `mouseleave` in that case).
    if (open) {
      cancelPeekClose();
      setPeekActive(false);
    }
  }, [cancelPeekClose, open]);

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
        //
        // The peek animates opacity AND a short slide from behind its own left
        // edge, because opacity alone reads as a pop however long it runs: the
        // panel is a full-height slab, so with nothing moving there is no
        // direction to the reveal and the eye only registers the arrival. The
        // slide is deliberately a fraction of the panel width (not the full
        // travel a toggle makes) — it says "this came from the edge" without
        // pretending the layout moved.
        //
        // Durations and curves are chosen against what each transition is:
        // arriving is `panel` geometry with `out-cubic`, which spends the budget
        // on a quick departure that decelerates into place; `out-quint` covers
        // ~86% of the distance in the first third and is what made this snap.
        // Leaving keeps the faster `exit` role and slides back the way it came.
        // `translate`, not `transform`: Tailwind's translate utilities compile to
        // the standalone `translate` property, so a transition on `transform`
        // animates nothing and the slide silently snaps.
        className={`absolute inset-y-0 left-0 flex flex-col overflow-hidden bg-sidebar transition-[opacity,translate] will-change-[opacity,translate] ${
          open
            ? `pointer-events-auto translate-x-0 opacity-100 duration-enter ease-out-cubic ${edgeClassName}`
            : peekActive
              ? "pointer-events-auto translate-x-0 opacity-100 shadow-popover border-r border-border duration-panel ease-out-cubic"
              : "pointer-events-none -translate-x-2 opacity-0 duration-exit ease-out-cubic"
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
