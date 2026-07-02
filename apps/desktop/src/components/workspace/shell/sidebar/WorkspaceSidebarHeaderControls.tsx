import { SidebarUpdatePill } from "@/components/workspace/shell/sidebar/SidebarUpdatePill";
import type { UpdaterPhase } from "@/stores/updater/updater-store";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { SplitPanel } from "@proliferate/ui/icons";

interface WorkspaceSidebarHeaderControlsProps {
  className: string;
  toggleTitle: string;
  iconTone?: "sidebar";
  phase: UpdaterPhase;
  downloadProgress: number | null;
  /**
   * The update pill moved into the sidebar bottom account row (UX spec §2.5).
   * Header chrome only shows it when the sidebar (and its footer) is hidden.
   */
  showUpdatePill?: boolean;
  onToggleSidebar: () => void;
  onDownloadUpdate: () => void;
  onOpenRestartPrompt: () => void;
}

export function WorkspaceSidebarHeaderControls({
  className,
  toggleTitle,
  iconTone,
  phase,
  downloadProgress,
  showUpdatePill = true,
  onToggleSidebar,
  onDownloadUpdate,
  onOpenRestartPrompt,
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
        <SplitPanel className="size-4" />
      </IconButton>
      {showUpdatePill && (
        <SidebarUpdatePill
          phase={phase}
          downloadProgress={downloadProgress}
          onDownloadUpdate={onDownloadUpdate}
          onOpenRestartPrompt={onOpenRestartPrompt}
        />
      )}
    </div>
  );
}
