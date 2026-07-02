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
      {/* The update pill's single home is the top-left, next to the sidebar
          toggle — it covers every updater phase whether the sidebar is open
          or hidden. */}
      <SidebarUpdatePill
        phase={phase}
        downloadProgress={downloadProgress}
        onDownloadUpdate={onDownloadUpdate}
        onOpenRestartPrompt={onOpenRestartPrompt}
      />
    </div>
  );
}
