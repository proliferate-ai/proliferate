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
      label="File browser"
      widthClassName="w-[min(360px,calc(100%-1rem))]"
      dataAttribute="file-browser-overlay"
      onClose={onClose}
    >
      <WorkspaceFileBrowserPane
        workspaceId={workspaceId}
        selectedPath={selectedPath}
        pathPrefix={pathPrefix}
        autoFocusSearch
        onPathPrefixChange={onPathPrefixChange}
        onOpenFile={onOpenFile}
      />
    </PaneSideOverlay>
  );
}
