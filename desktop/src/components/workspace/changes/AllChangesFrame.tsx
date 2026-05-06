import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type AnyHarnessQueryTimingOptions,
  useGitBranchDiffFilesQuery,
  useGitDiffQuery,
  useGitStatusQuery,
} from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  RefreshCw,
  SplitPanel,
} from "@/components/ui/icons";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  buildGitPanelFiles,
  gitPanelModeLabel,
  type GitPanelFile,
} from "@/lib/domain/workspaces/git-panel-diff";
import {
  viewerTargetKey,
  type ViewerTarget,
} from "@/lib/domain/workspaces/viewer-target";
import {
  serializeViewedKey,
  useWorkspaceChangeReviewStore,
} from "@/stores/editor/workspace-change-review-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import {
  recordMeasurementDiagnostic,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";
import { useDiffReviewMeasurement } from "@/hooks/workspaces/files/use-diff-review-measurement";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";

type AllChangesTarget = Extract<ViewerTarget, { kind: "allChanges" }>;
type SectionScope = "unstaged" | "staged" | "branch";

type AllChangesRow =
  | { kind: "section"; key: string; sectionScope: SectionScope; label: string; count: number; collapsed: boolean }
  | { kind: "file"; key: string; sectionScope: SectionScope; file: GitPanelFile; collapsed: boolean };

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
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionScope>>(new Set());
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
    if (target.scope === "branch") {
      const files = buildGitPanelFiles({
        mode: "branch",
        statusFiles: [],
        branchFiles: branchFilesQuery.data?.files ?? [],
      });
      return sectionRows({
        scope: "branch",
        label: gitPanelModeLabel("branch"),
        files,
        collapsedSections,
        collapsedFiles,
      });
    }
    const statusFiles = statusQuery.data?.files ?? [];
    if (target.scope === "working_tree_composite") {
      return [
        ...sectionRows({
          scope: "unstaged",
          label: "Unstaged",
          files: buildGitPanelFiles({
            mode: "unstaged",
            statusFiles,
            branchFiles: [],
          }),
          collapsedSections,
          collapsedFiles,
        }),
        ...sectionRows({
          scope: "staged",
          label: "Staged",
          files: buildGitPanelFiles({
            mode: "staged",
            statusFiles,
            branchFiles: [],
          }),
          collapsedSections,
          collapsedFiles,
        }),
      ];
    }
    return sectionRows({
      scope: target.scope,
      label: gitPanelModeLabel(target.scope),
      files: buildGitPanelFiles({
        mode: target.scope,
        statusFiles,
        branchFiles: [],
      }),
      collapsedSections,
      collapsedFiles,
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

  const changedFileCount = rows.reduce(
    (count, row) => row.kind === "section" ? count + row.count : count,
    0,
  );
  const isLoading = statusQuery.isLoading || (target.scope === "branch" && branchFilesQuery.isLoading);
  const title = target.scope === "working_tree_composite"
    ? "All changes"
    : `All ${gitPanelModeLabel(target.scope).toLowerCase()} changes`;
  const subtitle = target.scope === "working_tree_composite"
    ? "Working tree"
    : gitPanelModeLabel(target.scope);

  const toggleSectionCollapsed = useCallback((scope: SectionScope) => {
    setCollapsedSections((current) => toggleSetValue(current, scope));
  }, []);

  const toggleFileCollapsed = useCallback((key: string) => {
    setCollapsedFiles((current) => toggleSetValue(current, key));
  }, []);

  return (
    <DebugProfiler id="all-changes-frame">
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-4 text-foreground">
            {title}
          </p>
          <p className="text-[10px] leading-3 text-muted-foreground">
            {subtitle} · {changedFileCount} file{changedFileCount === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setWrapLongLines((value) => !value)}
          className="h-7 px-2 text-xs"
        >
          Wrap
        </Button>
        <Tooltip content={layout === "split" ? "Unified diff" : "Split diff"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setTargetLayout(targetKey, layout === "split" ? "unified" : "split")}
            aria-label="Toggle diff layout"
            className="size-7"
          >
            <SplitPanel className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Refresh changes">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void statusQuery.refetch();
              if (target.scope === "branch") {
                void branchFilesQuery.refetch();
              }
            }}
            aria-label="Refresh changes"
            className="size-7"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
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
                    <SectionHeaderRow
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

function SectionHeaderRow({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="unstyled"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-none border-b border-border bg-background px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/30 hover:text-foreground"
    >
      <ChevronRight
        className={`size-3.5 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
      />
      <span className="min-w-0 flex-1 truncate">
        {label} · {count}
      </span>
    </Button>
  );
}

function AllChangesFileRow({
  allChangesTargetKey,
  workspaceId,
  sectionScope,
  file,
  baseRef,
  layout,
  wrapLongLines,
  collapsed,
  onToggleCollapsed,
  openFile,
  openFileDiff,
  diffTimingOptions,
  measurementOperationId,
}: {
  allChangesTargetKey: string;
  workspaceId: string | null;
  sectionScope: SectionScope;
  file: GitPanelFile;
  baseRef: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  openFile: (path: string) => Promise<void>;
  openFileDiff: (
    path: string,
    options?: {
      scope?: SectionScope | null;
      baseRef?: string | null;
      oldPath?: string | null;
    },
  ) => Promise<void>;
  diffTimingOptions: AnyHarnessQueryTimingOptions;
  measurementOperationId: MeasurementOperationId | null;
}) {
  const viewedKey = serializeViewedKey({
    allChangesTargetKey,
    sectionScope,
    path: file.path,
    oldPath: file.oldPath,
  });
  const isViewed = useWorkspaceChangeReviewStore((s) => Boolean(s.viewedByKey[viewedKey]));
  const toggleViewed = useWorkspaceChangeReviewStore((s) => s.toggleViewed);
  const diffQuery = useGitDiffQuery({
    workspaceId,
    path: file.path,
    scope: sectionScope,
    baseRef: sectionScope === "branch" ? baseRef : null,
    oldPath: sectionScope === "branch" ? file.oldPath : null,
    enabled: !collapsed,
    ...diffTimingOptions,
  });

  return (
    <section className="border-b border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2">
        <Tooltip content={collapsed ? "Expand diff" : "Collapse diff"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.displayPath} diff`}
            className="size-7 rounded-md"
          >
            <ChevronRight
              className={`size-3.5 transition-transform ${collapsed ? "" : "rotate-90"}`}
            />
          </Button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void openFile(file.path)}
            title={file.displayPath}
            className="h-auto max-w-full justify-start rounded-none bg-transparent p-0 text-left text-xs font-medium text-foreground hover:bg-transparent hover:underline"
          >
            <span className="min-w-0 truncate [direction:ltr] [unicode-bidi:plaintext]">
              {file.displayPath}
            </span>
          </Button>
          <p className="text-[10px] text-muted-foreground">
            +{file.additions} -{file.deletions}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void openFile(file.path)}
          className="h-7 gap-1 px-2 text-xs"
        >
          <FileText className="size-3" />
          File
        </Button>
        <Tooltip content="Open as focused diff">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void openFileDiff(file.path, {
              scope: sectionScope,
              baseRef: sectionScope === "branch" ? baseRef : null,
              oldPath: sectionScope === "branch" ? file.oldPath : null,
            })}
            aria-label={`Open ${file.displayPath} diff`}
            className="size-7"
          >
            <ArrowUpRight className="size-3.5" />
          </Button>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={isViewed}
          onClick={() => toggleViewed({
            allChangesTargetKey,
            sectionScope,
            path: file.path,
            oldPath: file.oldPath,
          })}
          className={`h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium ${
            isViewed
              ? "text-foreground hover:bg-accent hover:text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${
              isViewed
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/70"
            }`}
          >
            {isViewed && <Check className="size-3" />}
          </span>
          Viewed
        </Button>
      </div>
      {collapsed ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Diff collapsed
        </div>
      ) : diffQuery.isLoading ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">Loading diff</p>
      ) : diffQuery.data?.patch ? (
        <DiffViewer
          patch={diffQuery.data.patch}
          filePath={file.displayPath}
          wrapLongLines={wrapLongLines}
          layout={layout}
          operationId={measurementOperationId}
        />
      ) : (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">
          {diffQuery.data?.binary ? "Binary file changed" : "No diff available"}
        </p>
      )}
    </section>
  );
}

function sectionRows({
  scope,
  label,
  files,
  collapsedSections,
  collapsedFiles,
}: {
  scope: SectionScope;
  label: string;
  files: GitPanelFile[];
  collapsedSections: Set<SectionScope>;
  collapsedFiles: Set<string>;
}): AllChangesRow[] {
  if (files.length === 0) {
    return [];
  }
  const sectionCollapsed = collapsedSections.has(scope);
  const fileRows = sectionCollapsed
    ? []
    : files.map((file) => {
        const key = `file:${scope}:${file.key}`;
        return {
          kind: "file" as const,
          key,
          sectionScope: scope,
          file,
          collapsed: collapsedFiles.has(key),
        };
      });
  return [
    {
      kind: "section",
      key: `section:${scope}`,
      sectionScope: scope,
      label,
      count: files.length,
      collapsed: sectionCollapsed,
    },
    ...fileRows,
  ];
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
