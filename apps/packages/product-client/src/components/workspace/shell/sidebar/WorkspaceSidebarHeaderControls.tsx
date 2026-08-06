import type { ReactNode } from "react";
import { IconButton } from "#product/primitives/IconButton";
import { SplitPanelLeft } from "#product/primitives/icons/app-shell";
import { useMacWindowControlsInsetClass } from "#product/hooks/ui/layout/use-mac-window-controls";

interface WorkspaceSidebarHeaderControlsProps {
  /** Extra classes beyond the macOS-controls inset, e.g. `"pr-2"`. */
  className?: string;
  toggleTitle: string;
  iconTone?: "sidebar";
  onToggleSidebar: () => void;
  trailing?: ReactNode;
}

/**
 * Top-left window chrome: the sidebar toggle, plus whatever the caller needs
 * reachable even while the sidebar itself is gone. The update control lives
 * in the sidebar footer while the sidebar is open, but that footer unmounts
 * along with the rest of the panel when it collapses — a caller rendering
 * this component for the collapsed state passes the update button in as
 * `trailing` so it stays a normal tab-focusable element in the always-on
 * chrome, rather than something a hover-only peek has to surface.
 *
 * The macOS window-controls inset is resolved here rather than passed in by
 * callers, so every call site gets the same host check instead of each one
 * having to remember to gate its own `pl-[82px]`.
 */
export function WorkspaceSidebarHeaderControls({
  className = "",
  toggleTitle,
  iconTone,
  onToggleSidebar,
  trailing,
}: WorkspaceSidebarHeaderControlsProps) {
  const macWindowControlsInsetClass = useMacWindowControlsInsetClass();
  return (
    <div className={`flex h-full items-center gap-2 ${macWindowControlsInsetClass} ${className}`}>
      <IconButton
        tone={iconTone}
        size="sm"
        onClick={onToggleSidebar}
        title={toggleTitle}
        className="rounded-md"
      >
        <SplitPanelLeft className="icon-control [font-size:var(--text-ui)]" />
      </IconButton>
      {trailing}
    </div>
  );
}
