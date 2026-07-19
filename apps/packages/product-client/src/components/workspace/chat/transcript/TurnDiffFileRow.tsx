import type { ReactNode } from "react";
import { FileChangeStats } from "#product/components/content/ui/FileChangeStats";
import { ChatDiffLineWrapContextMenu } from "#product/components/content/ui/diff/ChatDiffLineWrapContextMenu";
import { ArrowUpRight } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";

interface TurnDiffFileRowProps {
  filePath: string;
  additions: number;
  deletions: number;
  showStats: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenFile?: () => void;
  children?: ReactNode;
}

export function TurnDiffFileRow({
  filePath,
  additions,
  deletions,
  showStats,
  isExpanded,
  onToggleExpand,
  onOpenFile,
  children,
}: TurnDiffFileRowProps) {
  const { directory, basename } = splitDisplayPath(filePath);
  const header = (
    <div
      data-chat-diff-wrap-context-trigger="file-header"
      className="relative flex h-9 w-full min-w-0 items-center bg-background/70 text-chat leading-[var(--text-chat--line-height)] text-foreground hover:bg-list-hover/60"
    >
      <Button
        type="button"
        variant="unstyled"
        size="unstyled"
        data-chat-transcript-ignore
        data-app-action-review-file-toggle=""
        data-app-action-review-file-expanded={isExpanded ? "true" : "false"}
        aria-expanded={isExpanded}
        aria-label={`Toggle diff for ${filePath}`}
        title={filePath}
        onClick={onToggleExpand}
        className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
      />
      <div className="pointer-events-none relative z-10 flex w-full min-w-0 items-center gap-2 px-[var(--turn-diff-row-padding-x)] py-[var(--turn-diff-row-padding-y)] text-left">
        <span className="min-w-0 flex-1 truncate [direction:ltr] [unicode-bidi:plaintext]">
          {directory && (
            <span className="text-muted-foreground">{directory}</span>
          )}
          <span className="text-foreground">{basename}</span>
        </span>
        {showStats && (
          <FileChangeStats
            additions={additions}
            deletions={deletions}
            className="text-chat leading-none"
            rolling
          />
        )}
        {onOpenFile && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-chat-transcript-ignore
            aria-label={`Open ${filePath}`}
            title="Open file"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile();
            }}
            className="turn-diff-file-open pointer-events-auto size-6 shrink-0 rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1"
          >
            <ArrowUpRight className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="thread-diff-virtualized" data-diff-surface="chat">
      <ChatDiffLineWrapContextMenu trigger={header} />
      {isExpanded && children ? (
        <div className="relative overflow-hidden">{children}</div>
      ) : null}
    </div>
  );
}

function splitDisplayPath(path: string): { directory: string; basename: string } {
  const normalized = path.replace(/\\/g, "/");
  const separatorIndex = normalized.lastIndexOf("/");

  if (separatorIndex < 0) {
    return { directory: "", basename: path };
  }

  return {
    directory: normalized.slice(0, separatorIndex + 1),
    basename: normalized.slice(separatorIndex + 1) || normalized,
  };
}
