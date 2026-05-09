import {
  type AnyHarnessQueryTimingOptions,
  useGitDiffQuery,
} from "@anyharness/sdk-react";
import { Button } from "@/components/ui/Button";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import type {
  GitPanelFile,
  GitPanelSectionScope,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  serializeViewedKey,
  useWorkspaceChangeReviewStore,
} from "@/stores/editor/workspace-change-review-store";

export function AllChangesFileRow({
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
  sectionScope: GitPanelSectionScope;
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
      scope?: GitPanelSectionScope | null;
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
