import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useGitBranchDiffFilesQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { AllChangesFileRow } from "@/components/workspace/changes/AllChangesFileRow";
import { AllChangesSectionHeaderRow } from "@/components/workspace/changes/AllChangesSectionHeaderRow";
import { AllChangesToolbar } from "@/components/workspace/changes/AllChangesToolbar";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import {
  buildAllChangesRows,
  countAllChangesFiles,
  resolveAllChangesFrameHeader,
  type AllChangesRow,
  type AllChangesTarget,
} from "@/lib/domain/workspaces/changes/all-changes-review";
import type { GitPanelSectionScope } from "@/lib/domain/workspaces/changes/git-panel-diff";
import { viewerTargetKey } from "@/lib/domain/workspaces/viewer/viewer-target";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { recordMeasurementDiagnostic } from "@/lib/infra/measurement/debug-measurement";
import { useDiffReviewMeasurement } from "@/hooks/workspaces/files/lifecycle/use-diff-review-measurement";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/workflows/use-workspace-file-actions";

type DiffReviewMeasurementState = ReturnType<typeof useDiffReviewMeasurement>;

export function AllChangesFrame({ target }: { target: AllChangesTarget }) {
  const diffReviewMeasurement = useDiffReviewMeasurement();
  if (diffReviewMeasurement.deferQueryMount) {
    return (
      <DebugProfiler id="all-changes-frame">
        <div className="flex h-full min-w-0 flex-col overflow-hidden">
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading changes
          </p>
        </div>
      </DebugProfiler>
    );
  }

  return (
    <AllChangesFrameContent
      target={target}
      diffReviewMeasurement={diffReviewMeasurement}
    />
  );
}

function AllChangesFrameContent({
  target,
  diffReviewMeasurement,
}: {
  target: AllChangesTarget;
  diffReviewMeasurement: DiffReviewMeasurementState;
}) {
  const targetKey = viewerTargetKey(target);
  const workspaceId = useSessionSelectionStore((s) => s.selectedWorkspaceId);
  const layout = useWorkspaceViewerTabsStore((s) => s.layoutByTargetKey[targetKey] ?? "unified");
  const setTargetLayout = useWorkspaceViewerTabsStore((s) => s.setTargetLayout);
  const [wrapLongLines, setWrapLongLines] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<GitPanelSectionScope>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const { openFile, openFileDiff } = useWorkspaceFileActions();
  const statusQuery = useGitStatusQuery({
    workspaceId,
    ...diffReviewMeasurement.statusTimingOptions,
  });
  const branchFilesQuery = useGitBranchDiffFilesQuery({
    workspaceId,
    baseRef: target.baseRef,
    enabled: target.scope === "branch",
    ...diffReviewMeasurement.branchDiffFilesTimingOptions,
  });

  const rows = useMemo<AllChangesRow[]>(() => {
    return buildAllChangesRows({
      branchFiles: branchFilesQuery.data?.files ?? [],
      collapsedFiles,
      collapsedSections,
      statusFiles: statusQuery.data?.files ?? [],
      target,
    });
  }, [
    branchFilesQuery.data?.files,
    collapsedFiles,
    collapsedSections,
    statusQuery.data?.files,
    target.scope,
  ]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row || row.kind === "section") return 40;
      return row.collapsed ? 72 : 300;
    },
    overscan: 4,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const visibleFileRowCount = virtualItems.reduce((count, item) => {
    const row = rows[item.index];
    return row?.kind === "file" ? count + 1 : count;
  }, 0);

  useEffect(() => {
    if (!diffReviewMeasurement.operationId) {
      return;
    }
    recordMeasurementDiagnostic({
      category: "diff_review",
      label: "visible_rows",
      operationId: diffReviewMeasurement.operationId,
      durationMs: 0,
      count: virtualItems.length,
    });
    recordMeasurementDiagnostic({
      category: "diff_review",
      label: "visible_file_rows",
      operationId: diffReviewMeasurement.operationId,
      durationMs: 0,
      count: visibleFileRowCount,
    });
  }, [
    diffReviewMeasurement.operationId,
    virtualItems.length,
    visibleFileRowCount,
  ]);

  const changedFileCount = countAllChangesFiles(rows);
  const isLoading = statusQuery.isLoading || (target.scope === "branch" && branchFilesQuery.isLoading);
  const { title, subtitle } = resolveAllChangesFrameHeader(target);

  const handleRefresh = useCallback(() => {
    void statusQuery.refetch();
    if (target.scope === "branch") {
      void branchFilesQuery.refetch();
    }
  }, [branchFilesQuery, statusQuery, target.scope]);

  const handleToggleLayout = useCallback(() => {
    setTargetLayout(
      targetKey,
      layout === "split" ? "unified" : "split",
    );
  }, [layout, setTargetLayout, targetKey]);

  const handleToggleWrap = useCallback(() => {
    setWrapLongLines((value) => !value);
  }, []);

  const toggleSectionCollapsed = useCallback((scope: GitPanelSectionScope) => {
    setCollapsedSections((current) => toggleSetValue(current, scope));
  }, []);

  const toggleFileCollapsed = useCallback((key: string) => {
    setCollapsedFiles((current) => toggleSetValue(current, key));
  }, []);

  return (
    <DebugProfiler id="all-changes-frame">
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <AllChangesToolbar
          changedFileCount={changedFileCount}
          layout={layout}
          onRefresh={handleRefresh}
          onToggleLayout={handleToggleLayout}
          onToggleWrap={handleToggleWrap}
          subtitle={subtitle}
          title={title}
        />
        <AutoHideScrollArea ref={parentRef} className="min-h-0 flex-1">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading changes</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No changes</p>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualItems.map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                return (
                  <div
                    key={row.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {row.kind === "section" ? (
                      <AllChangesSectionHeaderRow
                        label={row.label}
                        count={row.count}
                        collapsed={row.collapsed}
                        onToggle={() => toggleSectionCollapsed(row.sectionScope)}
                      />
                    ) : (
                      <AllChangesFileRow
                        allChangesTargetKey={targetKey}
                        workspaceId={workspaceId}
                        sectionScope={row.sectionScope}
                        file={row.file}
                        baseRef={target.scope === "branch" ? target.baseRef : null}
                        layout={layout}
                        wrapLongLines={wrapLongLines}
                        collapsed={row.collapsed}
                        onToggleCollapsed={() => toggleFileCollapsed(row.key)}
                        openFile={openFile}
                        openFileDiff={openFileDiff}
                        diffTimingOptions={diffReviewMeasurement.diffTimingOptions}
                        measurementOperationId={diffReviewMeasurement.operationId}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </AutoHideScrollArea>
      </div>
    </DebugProfiler>
  );
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}
