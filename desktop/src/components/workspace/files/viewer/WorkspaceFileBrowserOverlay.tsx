import { ModalShell } from "@/components/ui/ModalShell";
import { WorkspaceFileBrowserPane } from "./WorkspaceFileBrowserPane";

interface WorkspaceFileBrowserOverlayProps {
  open: boolean;
  workspaceId: string | null;
  selectedPath: string;
  pathPrefix: string;
  onPathPrefixChange: (pathPrefix: string) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

export function WorkspaceFileBrowserOverlay({
  open,
  workspaceId,
  selectedPath,
  pathPrefix,
  onPathPrefixChange,
  onOpenFile,
  onClose,
}: WorkspaceFileBrowserOverlayProps) {
  const directoryLabel = pathPrefix.trim() || "Workspace root";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Browse files"
      description={directoryLabel}
      sizeClassName="h-[min(72vh,42rem)] max-w-2xl"
      bodyClassName="p-0"
      panelClassName="border-sidebar-border/80 bg-sidebar-background/95 text-sidebar-foreground shadow-floating-dark backdrop-blur"
      overlayClassName="bg-overlay/40 backdrop-blur-sm"
    >
      <div className="h-full min-h-0" data-file-browser-overlay>
        <WorkspaceFileBrowserPane
          workspaceId={workspaceId}
          selectedPath={selectedPath}
          pathPrefix={pathPrefix}
          autoFocusSearch
          onPathPrefixChange={onPathPrefixChange}
          onOpenFile={onOpenFile}
        />
      </div>
    </ModalShell>
  );
}
