import { useState } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { useDiffHighlight } from "@/hooks/ui/use-diff-highlight";
import type {
  DiffLine,
  CollapsedContext,
  DiffHunk,
} from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/highlighting";

interface DiffViewerProps {
  patch: string;
  filePath?: string;
  className?: string;
  viewportClassName?: string;
  wrapLongLines?: boolean;
}

const LINE_BG: Record<DiffLine["type"], string> = {
  added: "bg-[var(--git-new-line-bg)]",
  removed: "bg-[var(--git-removed-line-bg)]",
  context: "",
};

const LINE_MARKER: Record<DiffLine["type"], string> = {
  added: "text-[color:var(--color-git-new-line)]",
  removed: "text-[color:var(--color-git-removed-line)]",
  context: "text-muted-foreground/30",
};

function TokenizedContent({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
}) {
  const lineTokens = tokens?.[line.tokenIndex];

  if (lineTokens) {
    return (
      <>
        {lineTokens.map((tok, i) => (
          <span key={i} style={tok.color ? { color: tok.color } : undefined}>
            {tok.content}
          </span>
        ))}
      </>
    );
  }

  return <>{line.content || " "}</>;
}

function DiffLineRow({
  line,
  tokens,
  wrapLongLines,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
}) {
  return (
    <div className={`flex min-w-max py-px ${LINE_BG[line.type]}`}>
      <span className="inline-block w-6 shrink-0 select-none pr-1 text-right text-[10px] text-muted-foreground/30">
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
        <TokenizedContent line={line} tokens={tokens} />
      </span>
    </div>
  );
}

function CollapsedSection({
  section,
  tokens,
  wrapLongLines,
}: {
  section: CollapsedContext;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
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
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setExpanded(true);
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
}: {
  hunk: DiffHunk;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
}) {
  return (
    <div>
      {hunk.contextLabel && (
        <div className="px-3 py-0.5 text-[10px] italic text-muted-foreground/50">
          {hunk.contextLabel}
        </div>
      )}
      {hunk.items.map((item, i) => {
        if ("kind" in item && item.kind === "collapsed") {
          return (
            <CollapsedSection
              key={`c-${i}`}
              section={item}
              tokens={tokens}
              wrapLongLines={wrapLongLines}
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
          />
        );
      })}
    </div>
  );
}

export function DiffViewer({
  patch,
  filePath,
  className,
  viewportClassName,
  wrapLongLines = false,
}: DiffViewerProps) {
  const { parsed, tokens } = useDiffHighlight(patch, filePath);

  return (
    <AutoHideScrollArea
      className={`font-mono text-xs leading-relaxed ${className ?? ""}`}
      viewportClassName={viewportClassName}
      contentClassName={wrapLongLines ? "" : "min-w-max"}
      allowHorizontal={!wrapLongLines}
    >
      {parsed.hunks.map((hunk, i) => (
        <HunkView
          key={i}
          hunk={hunk}
          tokens={tokens}
          wrapLongLines={wrapLongLines}
        />
      ))}
    </AutoHideScrollArea>
  );
}
