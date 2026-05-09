import { useState } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { DiffLineContent } from "@/components/ui/content/diff/DiffLineContent";
import type {
  CollapsedContext,
  DiffHunk,
  DiffLine,
  ParsedPatch,
} from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

const LINE_BG: Record<DiffLine["type"], string> = {
  added: "bg-[var(--color-diff-added-bg)]",
  removed: "bg-[var(--color-diff-deleted-bg)]",
  context: "",
};

const LINE_MARKER: Record<DiffLine["type"], string> = {
  added: "text-[color:var(--color-diff-added)]",
  removed: "text-[color:var(--color-diff-deleted)]",
  context: "text-muted-foreground/30",
};

function DiffLineRow({
  line,
  tokens,
  wrapLongLines,
  variant,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  variant: "default" | "chat";
}) {
  const lineNumberClass =
    variant === "chat"
      ? "inline-block min-w-[4ch] shrink-0 select-none pr-1.5 text-right text-[10px] text-muted-foreground/35"
      : "inline-block w-6 shrink-0 select-none pr-1 text-right text-[10px] text-muted-foreground/30";

  return (
    <div className={`flex min-w-max py-px ${LINE_BG[line.type]}`}>
      <span className={lineNumberClass}>
        {line.lineNum ?? ""}
      </span>
      <span
        className={`inline-block w-4 shrink-0 select-none whitespace-pre text-center text-[11px] ${LINE_MARKER[line.type]}`}
      >
        {line.marker}
      </span>
      <span
        className={`pr-3 ${wrapLongLines ? "min-w-0 flex-1 whitespace-pre-wrap break-words" : "whitespace-pre"}`}
      >
        <DiffLineContent line={line} tokens={tokens} />
      </span>
    </div>
  );
}

function CollapsedSection({
  section,
  tokens,
  wrapLongLines,
  variant,
}: {
  section: CollapsedContext;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  variant: "default" | "chat";
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <>
        {section.lines.map((line) => (
          <DiffLineRow
            key={line.tokenIndex}
            line={line}
            tokens={tokens}
            wrapLongLines={wrapLongLines}
            variant={variant}
          />
        ))}
      </>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          setExpanded(true);
        }
      }}
      className="flex cursor-pointer items-center justify-center py-0.5 text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/70 hover:bg-muted/20"
    >
      ↕ {section.lineCount} unmodified lines
    </div>
  );
}

function HunkView({
  hunk,
  tokens,
  wrapLongLines,
  variant,
}: {
  hunk: DiffHunk;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  variant: "default" | "chat";
}) {
  return (
    <div>
      {hunk.contextLabel && (
        <div className="px-3 py-0.5 text-[10px] italic text-muted-foreground/50">
          {hunk.contextLabel}
        </div>
      )}
      {hunk.items.map((item, index) => {
        if ("kind" in item && item.kind === "collapsed") {
          return (
            <CollapsedSection
              key={`c-${index}`}
              section={item}
              tokens={tokens}
              wrapLongLines={wrapLongLines}
              variant={variant}
            />
          );
        }
        const line = item as DiffLine;
        return (
          <DiffLineRow
            key={line.tokenIndex}
            line={line}
            tokens={tokens}
            wrapLongLines={wrapLongLines}
            variant={variant}
          />
        );
      })}
    </div>
  );
}

export function UnifiedDiffViewer({
  parsed,
  tokens,
  className,
  viewportClassName,
  wrapLongLines,
  variant,
}: {
  parsed: ParsedPatch;
  tokens: HighlightedToken[][] | null;
  className?: string;
  viewportClassName?: string;
  wrapLongLines: boolean;
  variant: "default" | "chat";
}) {
  return (
    <AutoHideScrollArea
      className={className}
      viewportClassName={viewportClassName}
      contentClassName={wrapLongLines ? "" : "min-w-max"}
      allowHorizontal={!wrapLongLines}
    >
      {parsed.hunks.map((hunk, index) => (
        <HunkView
          key={index}
          hunk={hunk}
          tokens={tokens}
          wrapLongLines={wrapLongLines}
          variant={variant}
        />
      ))}
    </AutoHideScrollArea>
  );
}
