import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { SplitPanelLeft } from "@proliferate/ui/icons";

interface WorkspaceSidebarHeaderControlsProps {
  className: string;
  toggleTitle: string;
  iconTone?: "sidebar";
  onToggleSidebar: () => void;
}

/**
 * Top-left window chrome: the sidebar toggle and nothing else. The update
 * affordance lives in the sidebar footer next to help, never here.
 */
export function WorkspaceSidebarHeaderControls({
  className,
  toggleTitle,
  iconTone,
  onToggleSidebar,
}: WorkspaceSidebarHeaderControlsProps) {
  return (
    <div className={`flex h-full items-center gap-2 ${className}`}>
      <IconButton
        tone={iconTone}
        size="sm"
        onClick={onToggleSidebar}
        title={toggleTitle}
        className="rounded-md"
      >
        <SplitPanelLeft className="icon-control [font-size:var(--text-ui)]" />
      </IconButton>
    </div>
  );
}
