import { useState, type CSSProperties } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { DiffLineContent } from "@/components/content/ui/diff/DiffLineContent";
import type {
  CollapsedContext,
  DiffHunk,
  DiffLine,
  ParsedPatch,
} from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

function getLineType(type: DiffLine["type"]): string {
  if (type === "added") return "change-addition";
  if (type === "removed") return "change-deletion";
  return "context";
}

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
  const lineType = getLineType(line.type);
  const lineNumberClass =
    variant === "chat"
      ? "diff-gutter-cell inline-block min-w-[4ch] shrink-0 select-none pr-1.5 text-right tabular-nums"
      : "diff-gutter-cell inline-block w-6 shrink-0 select-none pr-1 text-right tabular-nums";

  return (
    <div
      data-line-type={lineType}
      className="flex min-w-max"
    >
      <span className={lineNumberClass} data-line-type={lineType}>
        {line.lineNum ?? ""}
      </span>
      <span
        className="diff-content-cell inline-block w-4 shrink-0 select-none whitespace-pre text-center"
        data-line-type={lineType}
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
  overscrollBehavior,
  overscrollBehaviorX,
  overscrollBehaviorY,
  chainVerticalWheel,
}: {
  parsed: ParsedPatch;
  tokens: HighlightedToken[][] | null;
  className?: string;
  viewportClassName?: string;
  wrapLongLines: boolean;
  variant: "default" | "chat";
  overscrollBehavior?: CSSProperties["overscrollBehavior"];
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"];
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"];
  chainVerticalWheel?: boolean;
}) {
  return (
    <AutoHideScrollArea
      className={className}
      viewportClassName={`composer-diff-simple-line bg-[var(--codex-diffs-surface)] ${viewportClassName ?? ""}`}
      contentClassName={`min-h-full bg-[var(--codex-diffs-surface)] font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] text-[color:var(--diffs-fg)] ${
        wrapLongLines ? "" : "min-w-max"
      }`}
      allowHorizontal={!wrapLongLines}
      overscrollBehavior={overscrollBehavior}
      overscrollBehaviorX={overscrollBehaviorX}
      overscrollBehaviorY={overscrollBehaviorY}
      chainVerticalWheel={chainVerticalWheel}
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
