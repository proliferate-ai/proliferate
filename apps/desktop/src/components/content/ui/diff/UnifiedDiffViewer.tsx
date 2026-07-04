import { useMemo, useState, type CSSProperties } from "react";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { DiffLineContent } from "@/components/content/ui/diff/DiffLineContent";
import {
  DiffContextExpander,
  DiffGapInfoRow,
  type ExpandDirection,
} from "@/components/content/ui/diff/DiffContextExpander";
import type {
  CollapsedContext,
  DiffHunk,
  DiffLine,
  InterHunkGap,
  ParsedPatch,
} from "@/lib/domain/files/diff-parser";
import {
  clampGapReveal,
  resolveGapLineCount,
  useGapExpansion,
} from "@/hooks/ui/diff/use-gap-expansion";
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

function GapSeparator({
  gap,
  onExpand,
  canExpand,
}: {
  gap: InterHunkGap;
  onExpand: (direction: ExpandDirection) => void;
  canExpand: boolean;
}) {
  // The AutoHideScrollArea viewport owns horizontal scroll and there is
  // no sticky gutter in this simple layout, so the cluster pins at left 0.
  if (!canExpand) {
    if (gap.lineCount <= 0) return null;
    return <DiffGapInfoRow lineCount={gap.lineCount} />;
  }

  return <DiffContextExpander gap={gap} onExpand={onExpand} />;
}

function ExpandedGapLines({
  lines,
  wrapLongLines,
  variant,
}: {
  lines: DiffLine[];
  wrapLongLines: boolean;
  variant: "default" | "chat";
}) {
  return (
    <>
      {lines.map((line, i) => (
        <DiffLineRow
          key={`expanded-${line.newLineNum}-${i}`}
          line={line}
          tokens={null}
          wrapLongLines={wrapLongLines}
          variant={variant}
        />
      ))}
    </>
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
  fileLines,
  onRequestFileLines,
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
  fileLines?: string[];
  onRequestFileLines?: () => void;
}) {
  const { gapStates, expandGap } = useGapExpansion();
  const canExpandGaps = Boolean(fileLines || onRequestFileLines);
  const expandGapWithFetch = (
    gapIndex: number,
    gap: InterHunkGap,
    direction: ExpandDirection,
  ) => {
    onRequestFileLines?.();
    expandGap(gapIndex, gap, direction);
  };

  // Resolve unknown trailing gap counts against fetched file length
  const gaps = useMemo(
    () =>
      parsed.interHunkGaps.map((gap) => resolveGapLineCount(gap, fileLines)),
    [parsed.interHunkGaps, fileLines],
  );

  // Build expanded gap line arrays
  const expandedGapContent = useMemo(() => {
    const result = new Map<number, { topLines: DiffLine[]; bottomLines: DiffLine[]; residualGap: InterHunkGap | null }>();
    if (!fileLines || gapStates.size === 0) return result;
    for (const [gapIndex, state] of gapStates) {
      const gap = gaps[gapIndex];
      if (!gap || gap.lineCount <= 0) continue;
      const totalGapLines = gap.lineCount;
      const { top, bottom, fullyExpanded } = clampGapReveal(state, totalGapLines);
      if (top === 0 && bottom === 0) continue;

      const makeLine = (offset: number): DiffLine => {
        const newLine = gap.newStartLine + offset;
        return {
          type: "context",
          marker: " ",
          content: fileLines[newLine - 1] ?? "",
          oldLineNum: gap.oldStartLine + offset,
          newLineNum: newLine,
          lineNum: newLine,
          tokenIndex: -1,
        };
      };

      const topLines: DiffLine[] = [];
      for (let i = 0; i < top; i++) {
        topLines.push(makeLine(i));
      }

      const bottomLines: DiffLine[] = [];
      for (let i = totalGapLines - bottom; i < totalGapLines; i++) {
        bottomLines.push(makeLine(i));
      }

      let residualGap: InterHunkGap | null = null;
      if (!fullyExpanded) {
        residualGap = {
          kind: "gap",
          oldStartLine: gap.oldStartLine + top,
          newStartLine: gap.newStartLine + top,
          lineCount: totalGapLines - top - bottom,
        };
      }

      result.set(gapIndex, { topLines, bottomLines, residualGap });
    }
    return result;
  }, [fileLines, gapStates, gaps]);

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
      {parsed.hunks.map((hunk, index) => {
        const gapBefore = gaps[index];
        const expandedBefore = expandedGapContent.get(index);
        const showGapBefore = Boolean(gapBefore && gapBefore.lineCount !== 0);

        return (
          <div key={index}>
            {gapBefore && showGapBefore && expandedBefore && (
              <>
                <ExpandedGapLines lines={expandedBefore.topLines} wrapLongLines={wrapLongLines} variant={variant} />
                {expandedBefore.residualGap ? (
                  <GapSeparator
                    gap={expandedBefore.residualGap}
                    onExpand={(dir) => expandGapWithFetch(index, expandedBefore.residualGap!, dir)}
                    canExpand={canExpandGaps}
                  />
                ) : null}
                <ExpandedGapLines lines={expandedBefore.bottomLines} wrapLongLines={wrapLongLines} variant={variant} />
              </>
            )}
            {gapBefore && showGapBefore && !expandedBefore && (
              <GapSeparator
                gap={gapBefore}
                onExpand={(dir) => expandGapWithFetch(index, gapBefore, dir)}
                canExpand={canExpandGaps}
              />
            )}
            <HunkView
              hunk={hunk}
              tokens={tokens}
              wrapLongLines={wrapLongLines}
              variant={variant}
            />
          </div>
        );
      })}
      {/* Gap after last hunk */}
      {(() => {
        const lastGapIndex = parsed.hunks.length;
        const gapAfter = gaps[lastGapIndex];
        const expandedAfter = expandedGapContent.get(lastGapIndex);
        if (!gapAfter || gapAfter.lineCount === 0) return null;

        if (expandedAfter) {
          return (
            <div>
              <ExpandedGapLines lines={expandedAfter.topLines} wrapLongLines={wrapLongLines} variant={variant} />
              {expandedAfter.residualGap ? (
                <GapSeparator
                  gap={expandedAfter.residualGap}
                  onExpand={(dir) => expandGapWithFetch(lastGapIndex, expandedAfter.residualGap!, dir)}
                  canExpand={canExpandGaps}
                />
              ) : null}
              <ExpandedGapLines lines={expandedAfter.bottomLines} wrapLongLines={wrapLongLines} variant={variant} />
            </div>
          );
        }

        return (
          <GapSeparator
            gap={gapAfter}
            onExpand={(dir) => expandGapWithFetch(lastGapIndex, gapAfter, dir)}
            canExpand={canExpandGaps}
          />
        );
      })()}
    </AutoHideScrollArea>
  );
}
