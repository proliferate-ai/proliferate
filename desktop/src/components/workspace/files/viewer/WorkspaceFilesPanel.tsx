import {
  useEffect,
  useState,
} from "react";
import { PaneHeader } from "@/components/workspace/pane/PaneHeader";
import { useWorkspaceFileContext } from "@/hooks/workspaces/files/derived/use-workspace-file-context";
import { useWorkspaceFileTargetActions } from "@/hooks/workspaces/files/workflows/use-workspace-file-target-actions";
import { WorkspaceFileBrowserPane } from "./WorkspaceFileBrowserPane";

export function WorkspaceFilesPanel() {
  const fileContext = useWorkspaceFileContext();
  const { openFile } = useWorkspaceFileTargetActions(fileContext);
  const [pathPrefix, setPathPrefix] = useState("");

  useEffect(() => {
    setPathPrefix("");
  }, [fileContext.workspaceUiKey]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-sidebar-foreground">
      <PaneHeader
        left={(
          <div className="flex min-w-0 items-center px-1">
            <span className="truncate text-xs font-medium text-sidebar-foreground">
              Files
            </span>
          </div>
        )}
      />
      <WorkspaceFileBrowserPane
        workspaceId={fileContext.materializedWorkspaceId}
        selectedPath=""
        pathPrefix={pathPrefix}
        onPathPrefixChange={setPathPrefix}
        onOpenFile={(path) => {
          void openFile(path);
        }}
      />
    </div>
  );
}
