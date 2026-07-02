import { useState, type CSSProperties } from "react";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import { CheckCircleFilled } from "@proliferate/ui/icons";
import { GitReviewEmptyState } from "@/components/workspace/git/GitReviewEmptyState";
import {
  PLAYGROUND_SIDEBAR_GIT_DIFF_FILES,
  PLAYGROUND_SIDEBAR_GIT_DIFF_SECTIONS,
  type PlaygroundSidebarGitDiffFile,
} from "@/lib/domain/chat/__fixtures__/playground/git-diff-fixtures";

const SIDEBAR_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";
const SIDEBAR_DIFF_SURFACE_STYLE = {
  "--codex-diffs-surface-override": "var(--color-diff-surface)",
} as CSSProperties;

export function PlaygroundSidebarGitDiff() {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(PLAYGROUND_SIDEBAR_GIT_DIFF_FILES.map((file) => file.key)),
  );

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar-background text-sidebar-foreground">
      <div className="shrink-0 border-b border-sidebar-border/70 px-3 py-2">
        <p className="text-xs text-sidebar-muted-foreground">Git diff sidebar</p>
      </div>
      <div
        id="review-diffs-collapsed"
        data-app-action-review-scroll=""
        data-thread-find-target="review"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3"
      >
        <div className="relative flex flex-col gap-1.5 pt-2">
          <span
            aria-hidden="true"
            data-app-action-review-metrics-probe=""
            className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
          />
          {PLAYGROUND_SIDEBAR_GIT_DIFF_SECTIONS.map((section) => {
            const files = PLAYGROUND_SIDEBAR_GIT_DIFF_FILES.filter(
              (file) => file.section === section,
            );
            return (
              <section key={section} className="flex flex-col gap-1">
                <h2 className="px-1.5 text-sm font-medium uppercase tracking-wide text-sidebar-muted-foreground">
                  {section}
                </h2>
                {files.length > 0 ? (
                  files.map((file) => (
                    <PlaygroundSidebarGitDiffCard
                      key={file.key}
                      file={file}
                      isExpanded={expandedKeys.has(file.key)}
                      onToggle={() => toggleExpanded(file.key)}
                    />
                  ))
                ) : (
                  <GitReviewEmptyState
                    variant="inline"
                    icon={<CheckCircleFilled className="size-4" />}
                    title="Working tree clean"
                    description="No files to review in this section."
                  />
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlaygroundSidebarGitDiffCard({
  file,
  isExpanded,
  onToggle,
}: {
  file: PlaygroundSidebarGitDiffFile;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      data-review-path={file.displayPath}
      style={SIDEBAR_DIFF_SURFACE_STYLE}
    >
      <FileDiffCard
        filePath={file.displayPath}
        additions={file.additions}
        deletions={file.deletions}
        isExpanded={isExpanded}
        onToggleExpand={onToggle}
        surface="sidebar"
      >
        {file.binary ? (
          <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
            Binary file changed
          </p>
        ) : file.patch ? (
          <div>
            <DiffViewer
              patch={file.patch}
              filePath={file.displayPath}
              viewportClassName={SIDEBAR_DIFF_VIEWPORT_CLASS}
              variant="chat"
            />
            {file.truncated && (
              <p className="px-3 pb-1 text-sm text-sidebar-muted-foreground">
                Diff truncated
              </p>
            )}
          </div>
        ) : null}
      </FileDiffCard>
    </div>
  );
}
