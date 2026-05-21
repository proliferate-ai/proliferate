import { PaneSideOverlay } from "@/components/workspace/pane/PaneSideOverlay";
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
  return (
    <PaneSideOverlay
      open={open}
      label="Browse files"
      widthClassName="w-[min(320px,calc(100%-1rem))]"
      dataAttribute="file-browser-overlay"
      onClose={onClose}
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
    </PaneSideOverlay>
  );
}
