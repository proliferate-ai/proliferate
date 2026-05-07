import {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useWorkspaceFilesQuery } from "@anyharness/sdk-react";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { FilePlus, FolderPlus } from "@/components/ui/icons";
import { listOpenTargets, type OpenTarget } from "@/platform/tauri/shell";
import { FileTreeNode } from "./FileTreeNode";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { useNativeContextMenu } from "@/hooks/ui/use-native-context-menu";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/measurement/debug-measurement";

function FileTreePaneInner() {
  useDebugRenderCount("file-tree");
  const scrollSampleOperationRef = useRef<MeasurementOperationId | null>(null);
  const workspaceUiKey = useWorkspaceViewerTabsStore((s) => s.workspaceUiKey);
  const materializedWorkspaceId = useWorkspaceViewerTabsStore((s) => s.materializedWorkspaceId);
  const anyharnessWorkspaceId = useWorkspaceViewerTabsStore((s) => s.anyharnessWorkspaceId);
  const runtimeUrl = useWorkspaceViewerTabsStore((s) => s.runtimeUrl);
  const authToken = useWorkspaceViewerTabsStore((s) => s.authToken);
  const treeStateKey = useWorkspaceViewerTabsStore((s) => s.treeStateKey);
  const selectedDirectory = useWorkspaceFileTreeUiStore(
    (s) => treeStateKey ? s.selectedDirectoryByTreeKey[treeStateKey] ?? "" : "",
  );
  const startCreateDraft = useWorkspaceFileTreeUiStore((s) => s.startCreateDraft);
  const expandDirectory = useWorkspaceFileTreeUiStore((s) => s.expandDirectory);
  const { initForWorkspace } = useWorkspaceFileActions();
  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const rootQuery = useWorkspaceFilesQuery({
    workspaceId: materializedWorkspaceId,
    path: "",
    enabled: !!materializedWorkspaceId,
  });

  useEffect(() => {
    void listOpenTargets("file").then(setTargets);
  }, []);
  useEffect(() => () => {
    finishOrCancelMeasurementOperation(scrollSampleOperationRef.current, "unmount");
    scrollSampleOperationRef.current = null;
  }, []);

  const handleFileTreeScroll = useCallback(() => {
    const operationId = startMeasurementOperation({
      kind: "file_tree_scroll",
      sampleKey: "file_tree",
      surfaces: ["file-tree", "workspace-shell"],
      idleTimeoutMs: 750,
      maxDurationMs: 8000,
      cooldownMs: 1500,
    });
    if (operationId) {
      scrollSampleOperationRef.current = operationId;
      markOperationForNextCommit(operationId, ["file-tree", "workspace-shell"]);
    }
  }, []);

  const startCreateInSelectedDirectory = useCallback((kind: "file" | "directory") => {
    if (!treeStateKey) {
      return;
    }
    if (selectedDirectory) {
      expandDirectory(treeStateKey, selectedDirectory);
    }
    startCreateDraft(treeStateKey, { kind, parentPath: selectedDirectory });
  }, [expandDirectory, selectedDirectory, startCreateDraft, treeStateKey]);

  const backgroundNativeContextMenu = useNativeContextMenu(() => [
    {
      id: "new-file",
      label: "New File",
      enabled: Boolean(treeStateKey),
      onSelect: () => startCreateInSelectedDirectory("file"),
    },
    {
      id: "new-folder",
      label: "New Folder",
      enabled: Boolean(treeStateKey),
      onSelect: () => startCreateInSelectedDirectory("directory"),
    },
  ]);

  const handleBackgroundContextMenuCapture = useCallback((
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (isInsideFileTreeEntry(event.target)) {
      return;
    }
    backgroundNativeContextMenu.onContextMenuCapture(event);
  }, [backgroundNativeContextMenu]);

  const withBackgroundContextMenu = (children: ReactNode) => (
    <PopoverButton
      trigger={(
        <div
          className="h-full"
          onContextMenuCapture={handleBackgroundContextMenuCapture}
        >
          {children}
        </div>
      )}
      triggerMode="contextMenu"
      className="w-44 rounded-lg border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <FileTreeCreateMenu
          onNewFile={() => {
            startCreateInSelectedDirectory("file");
            close();
          }}
          onNewFolder={() => {
            startCreateInSelectedDirectory("directory");
            close();
          }}
        />
      )}
    </PopoverButton>
  );

  const rootEntries = rootQuery.data?.entries;
  useDebugValueChange("file_tree.inputs", "pane_refs", {
    anyharnessWorkspaceId,
    authToken,
    materializedWorkspaceId,
    rootEntries,
    rootQueryStatus: rootQuery.status,
    runtimeUrl,
    selectedDirectory,
    targets,
    treeStateKey,
    workspaceUiKey,
  });

  if (rootQuery.isLoading) {
    return withBackgroundContextMenu(
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 bg-muted/40 rounded animate-pulse" />
        ))}
      </div>,
    );
  }

  if (rootQuery.isError) {
    return (
      <div className="p-3 text-center">
        <p className="text-xs text-destructive mb-2">Failed to load files</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            workspaceUiKey
            && materializedWorkspaceId
            && anyharnessWorkspaceId
            && runtimeUrl
            && treeStateKey
            && initForWorkspace({
              workspaceUiKey,
              materializedWorkspaceId,
              anyharnessWorkspaceId,
              runtimeUrl,
              treeStateKey,
              authToken,
            })}
          className="h-7 px-2 text-xs"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!rootEntries || rootEntries.length === 0) {
    return withBackgroundContextMenu(
      <div className="p-3 text-center">
        <p className="text-xs text-muted-foreground">No files</p>
      </div>,
    );
  }

  return (
    <DebugProfiler id="file-tree">
      {withBackgroundContextMenu(
        <AutoHideScrollArea
          className="h-full"
          viewportClassName="py-1"
          onViewportScroll={handleFileTreeScroll}
        >
          {rootEntries.map((entry) => (
            <FileTreeNode key={entry.path} entry={entry} level={0} targets={targets} />
          ))}
        </AutoHideScrollArea>,
      )}
    </DebugProfiler>
  );
}

export const FileTreePane = memo(FileTreePaneInner);
FileTreePane.displayName = "FileTreePane";

function FileTreeCreateMenu({
  onNewFile,
  onNewFolder,
}: {
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  return (
    <div className="flex flex-col gap-px">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onNewFile}
        className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
      >
        <FilePlus className="size-3.5 shrink-0" />
        <span>New File</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onNewFolder}
        className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
      >
        <FolderPlus className="size-3.5 shrink-0" />
        <span>New Folder</span>
      </Button>
    </div>
  );
}

function isInsideFileTreeEntry(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("[data-file-tree-entry]"));
}
