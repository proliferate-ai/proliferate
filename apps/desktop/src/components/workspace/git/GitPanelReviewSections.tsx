import type { AnyHarnessQueryTimingOptions } from "@anyharness/sdk-react";
import { GitReviewFileRow } from "@/components/workspace/git/GitReviewFileRow";
import { GitReviewSectionHeader } from "@/components/workspace/git/GitPanelReviewChrome";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type {
  GitPanelMode,
  GitPanelReviewScope,
  GitPanelSection,
} from "@/lib/domain/workspaces/changes/git-panel-diff";
import { gitReviewEntryForFile } from "@/lib/domain/workspaces/changes/git-review-entries";

interface GitPanelReviewSectionsProps {
  changesFilter: GitPanelMode;
  sections: readonly GitPanelSection[];
  visibleSectionScopes: ReadonlySet<GitPanelReviewScope>;
  collapsedSections: ReadonlySet<GitPanelReviewScope>;
  activeWorkspaceId: string | null;
  baseRef: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  effectiveCollapsedFiles: ReadonlySet<string>;
  isRuntimeReady: boolean;
  permittedDiffFetchKeys: ReadonlySet<string>;
  openFile: (path: string) => Promise<void>;
  stagePath: (path: string) => Promise<unknown>;
  unstagePath: (path: string) => Promise<unknown>;
  onToggleSectionCollapsed: (scope: GitPanelReviewScope) => void;
  onToggleFileCollapsed: (key: string) => void;
  onDiffFetchSettled: (key: string) => void;
  diffTimingOptions?: AnyHarnessQueryTimingOptions;
  measurementOperationId?: MeasurementOperationId | null;
}

export function GitPanelReviewSections({
  changesFilter,
  sections,
  visibleSectionScopes,
  collapsedSections,
  activeWorkspaceId,
  baseRef,
  layout,
  wrapLongLines,
  effectiveCollapsedFiles,
  isRuntimeReady,
  permittedDiffFetchKeys,
  openFile,
  stagePath,
  unstagePath,
  onToggleSectionCollapsed,
  onToggleFileCollapsed,
  onDiffFetchSettled,
  diffTimingOptions,
  measurementOperationId,
}: GitPanelReviewSectionsProps) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.scope} className="flex flex-col gap-1">
          {changesFilter === "working_tree_composite" && (
            <GitReviewSectionHeader
              section={section}
              collapsed={collapsedSections.has(section.scope)}
              onToggle={() => onToggleSectionCollapsed(section.scope)}
            />
          )}
          {visibleSectionScopes.has(section.scope)
            && section.files.map((file) => {
              const entry = gitReviewEntryForFile(section.scope, file);
              return (
                <GitReviewFileRow
                  key={entry.key}
                  id={entry.id}
                  workspaceId={activeWorkspaceId}
                  sectionScope={section.scope}
                  file={file}
                  baseRef={baseRef}
                  layout={layout}
                  wrapLongLines={wrapLongLines}
                  collapsed={effectiveCollapsedFiles.has(entry.key)}
                  isRuntimeReady={isRuntimeReady}
                  fetchDiff={permittedDiffFetchKeys.has(entry.key)}
                  onToggleCollapsed={() => onToggleFileCollapsed(entry.key)}
                  onDiffFetchSettled={() => onDiffFetchSettled(entry.key)}
                  openFile={openFile}
                  stagePath={stagePath}
                  unstagePath={unstagePath}
                  diffTimingOptions={diffTimingOptions}
                  measurementOperationId={measurementOperationId}
                />
              );
            })}
        </div>
      ))}
    </>
  );
}
