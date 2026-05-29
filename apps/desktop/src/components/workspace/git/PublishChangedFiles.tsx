import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";

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
    <div className="space-y-3">
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
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{title}</p>
        <span className="text-xs text-muted-foreground">{files.length}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60">
        {files.map((file) => (
          <div
            key={`${title}:${file.path}`}
            className="flex items-center gap-3 border-b border-border/60 bg-surface-elevated-secondary px-3 py-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-start text-xs text-foreground [direction:rtl]" title={file.path}>
              <span className="[direction:ltr] [unicode-bidi:plaintext]">{file.path}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-git-green">+{file.additions}</span>
            <span className="shrink-0 text-xs tabular-nums text-git-red">-{file.deletions}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
