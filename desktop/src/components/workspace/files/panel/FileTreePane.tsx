import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useWorkspaceFileActions } from "@/hooks/editor/use-workspace-file-actions";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { listOpenTargets, type OpenTarget } from "@/platform/tauri/shell";
import { FileTreeNode } from "./FileTreeNode";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";

export function FileTreePane() {
  useDebugRenderCount("file-tree");
  const scrollSampleOperationRef = useRef<MeasurementOperationId | null>(null);
  const directoryEntriesByPath = useWorkspaceFilesStore((s) => s.directoryEntriesByPath);
  const directoryLoadStateByPath = useWorkspaceFilesStore((s) => s.directoryLoadStateByPath);
  const workspaceId = useWorkspaceFilesStore((s) => s.workspaceId);
  const runtimeWorkspaceId = useWorkspaceFilesStore((s) => s.runtimeWorkspaceId);
  const runtimeUrl = useWorkspaceFilesStore((s) => s.runtimeUrl);
  const authToken = useWorkspaceFilesStore((s) => s.authToken);
  const treeStateKey = useWorkspaceFilesStore((s) => s.treeStateKey);
  const { initForWorkspace } = useWorkspaceFileActions();
  const [targets, setTargets] = useState<OpenTarget[]>([]);

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

  const rootEntries = directoryEntriesByPath[""];
  const rootLoadState = directoryLoadStateByPath[""];

  if (rootLoadState === "loading") {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 bg-muted/40 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (rootLoadState === "error") {
    return (
      <div className="p-3 text-center">
        <p className="text-xs text-destructive mb-2">Failed to load files</p>
        <button
          onClick={() => workspaceId && runtimeUrl && treeStateKey && initForWorkspace(
            workspaceId,
            runtimeUrl,
            treeStateKey,
            runtimeWorkspaceId ?? undefined,
            authToken ?? undefined,
          )}
          className="text-xs text-foreground hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!rootEntries || rootEntries.length === 0) {
    return (
      <div className="p-3 text-center">
        <p className="text-xs text-muted-foreground">No files</p>
      </div>
    );
  }

  return (
    <DebugProfiler id="file-tree">
      <AutoHideScrollArea
        className="h-full"
        viewportClassName="py-1"
        onViewportScroll={handleFileTreeScroll}
      >
      {rootEntries.map((entry) => (
        <FileTreeNode key={entry.path} entry={entry} level={0} targets={targets} />
      ))}
      </AutoHideScrollArea>
    </DebugProfiler>
  );
}
