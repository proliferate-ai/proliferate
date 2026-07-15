import type { AnyHarnessQueryTimingOptions } from "@anyharness/sdk-react";
import { GitReviewFileRow } from "#product/components/workspace/git/GitReviewFileRow";
import type { MeasurementOperationId } from "#product/lib/domain/telemetry/debug-measurement-catalog";
import type {
  GitPanelMode,
  GitPanelSection,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { gitReviewEntryForFile } from "#product/lib/domain/workspaces/changes/git-review-entries";

interface GitPanelReviewSectionsProps {
  changesFilter: GitPanelMode;
  sections: readonly GitPanelSection[];
  activeWorkspaceId: string | null;
  baseRef: string | null;
  layout: "unified" | "split";
  wrapLongLines: boolean;
  collapsedFiles: ReadonlySet<string>;
  isRuntimeReady: boolean;
  permittedDiffFetchKeys: ReadonlySet<string>;
  openFile: (path: string) => Promise<void>;
  onToggleFileCollapsed: (key: string) => void;
  onDiffFetchSettled: (key: string) => void;
  diffTimingOptions?: AnyHarnessQueryTimingOptions;
  measurementOperationId?: MeasurementOperationId | null;
}

/**
 * One flat review document: file sections from every scope stack in a single
 * list with no section boxes or headers. In the composite working-tree view a
 * partially staged file can appear twice (staged + unstaged diffs differ);
 * the staged row carries a quiet "staged" chip to disambiguate.
 */
export function GitPanelReviewSections({
  changesFilter,
  sections,
  activeWorkspaceId,
  baseRef,
  layout,
  wrapLongLines,
  collapsedFiles,
  isRuntimeReady,
  permittedDiffFetchKeys,
  openFile,
  onToggleFileCollapsed,
  onDiffFetchSettled,
  diffTimingOptions,
  measurementOperationId,
}: GitPanelReviewSectionsProps) {
  const isComposite = changesFilter === "working_tree_composite";
  return (
    <div className="flex flex-col gap-0.5">
      {sections.flatMap((section) =>
        section.files.map((file) => {
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
              collapsed={collapsedFiles.has(entry.key)}
              isRuntimeReady={isRuntimeReady}
              fetchDiff={permittedDiffFetchKeys.has(entry.key)}
              showStagedChip={isComposite && section.scope === "staged"}
              onToggleCollapsed={() => onToggleFileCollapsed(entry.key)}
              onDiffFetchSettled={() => onDiffFetchSettled(entry.key)}
              openFile={openFile}
              diffTimingOptions={diffTimingOptions}
              measurementOperationId={measurementOperationId}
            />
          );
        })
      )}
    </div>
  );
}
