import { useState } from "react";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileDiffCard } from "@/components/ui/content/FileDiffCard";
import {
  PLAYGROUND_SIDEBAR_GIT_DIFF_FILES,
  PLAYGROUND_SIDEBAR_GIT_DIFF_SECTIONS,
  type PlaygroundSidebarGitDiffFile,
} from "@/lib/domain/chat/__fixtures__/playground";

const SIDEBAR_DIFF_VIEWPORT_CLASS = "max-h-[calc(var(--diffs-line-height)*18)]";

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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-2">
        {PLAYGROUND_SIDEBAR_GIT_DIFF_SECTIONS.map((section) => {
          const files = PLAYGROUND_SIDEBAR_GIT_DIFF_FILES.filter(
            (file) => file.section === section,
          );
          return (
            <section key={section} className="flex flex-col gap-2">
              <h2 className="px-1 text-xs font-medium text-sidebar-muted-foreground">
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
                <p className="rounded-lg bg-sidebar-accent px-3 py-4 text-center text-xs text-sidebar-muted-foreground">
                  Working tree clean
                </p>
              )}
            </section>
          );
        })}
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
            <p className="px-3 pb-1 text-[10px] text-sidebar-muted-foreground">
              Diff truncated
            </p>
          )}
        </div>
      ) : null}
    </FileDiffCard>
  );
}
