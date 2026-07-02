import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";

export interface PublishFileRow {
  path: string;
  additions: number;
  deletions: number;
}

interface PublishChangedFilesProps {
  groups: {
    staged: PublishFileRow[];
    partial: PublishFileRow[];
    unstaged: PublishFileRow[];
  };
  scroll: boolean;
}

export function PublishChangedFiles({ groups, scroll }: PublishChangedFilesProps) {
  const content = (
    <div>
      <PublishFileSection title="Staged" files={groups.staged} />
      <PublishFileSection title="Partially staged" files={groups.partial} />
      <PublishFileSection title="Unstaged" files={groups.unstaged} />
    </div>
  );

  if (!scroll) return content;

  return (
    <AutoHideScrollArea
      className="max-h-56 min-h-0"
      viewportClassName="max-h-56 pr-2"
    >
      {content}
    </AutoHideScrollArea>
  );
}

function PublishFileSection({
  title,
  files,
}: {
  title: string;
  files: PublishFileRow[];
}) {
  if (files.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between px-0.5 pb-1 pt-2">
        <p className="text-ui-sm font-medium text-muted-foreground">{title}</p>
        <span className="text-ui-sm tabular-nums text-muted-foreground">{files.length}</span>
      </div>
      <div className="divide-y divide-border/40">
        {files.map((file) => (
          <div
            key={`${title}:${file.path}`}
            className="flex items-center gap-3 px-0.5 py-1.5"
          >
            {/* rtl keeps the tail of long paths visible; text-left pins short
                paths to the reading edge (text-start maps to right under rtl) */}
            <span className="min-w-0 flex-1 truncate text-left text-ui-sm text-foreground [direction:rtl]" title={file.path}>
              <span className="[direction:ltr] [unicode-bidi:plaintext]">{file.path}</span>
            </span>
            {file.additions > 0 && (
              <span className="shrink-0 text-base tabular-nums text-git-green">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="shrink-0 text-base tabular-nums text-git-red">-{file.deletions}</span>
            )}
            {file.additions === 0 && file.deletions === 0 && (
              <span className="shrink-0 text-base text-muted-foreground">new</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
