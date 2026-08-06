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
 * Persistent top-left window chrome: the sidebar toggle, plus whatever must
 * remain reachable while the sidebar is collapsed. The owning shell mounts
 * this once above both the sidebar and content surfaces so the glyph never
 * moves or fades during a toggle.
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
