import type { ReactNode } from "react";
import { DiffLineContent } from "@/components/content/ui/diff/DiffLineContent";
import {
  DiffCollapsedContentLabel,
  DiffCollapsedGutterIcon,
  DiffGapContentLabel,
  DiffGapGutterControls,
  DiffGapInfoRow,
  type ExpandDirection,
} from "@/components/content/ui/diff/DiffContextExpander";
import { Button } from "@proliferate/ui/primitives/Button";
import type { CollapsedContext, DiffLine, InterHunkGap } from "@/lib/domain/files/diff-parser";
import {
  getChatLineNumber,
  getChatLineType,
  getDiffLineIndex,
} from "@/lib/domain/files/diff-view-rows";
import type { HighlightedToken } from "@/lib/infra/editor/highlighting";

export function ChatGutterLine({ line }: { line: DiffLine }) {
  const lineType = getChatLineType(line);
  const lineNumber = getChatLineNumber(line);

  return (
    <div
      data-line-type={lineType}
      data-column-number={lineNumber ?? undefined}
      data-line-index={getDiffLineIndex(line)}
      className="diff-gutter-cell box-border flex min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] items-start justify-end bg-[var(--diffs-bg)] pr-2 pl-3 pt-[calc((var(--diffs-line-height)-1em)/2)] text-right tabular-nums"
    >
      <span data-line-number-content="">{lineNumber ?? ""}</span>
    </div>
  );
}

export function ChatGutterSeparatorLine({ children }: { children?: React.ReactNode }) {
  return (
    <div
      data-separator="simple"
      className="diff-gutter-cell flex min-h-[var(--diffs-line-height)] items-center justify-center bg-[var(--codex-diffs-separator-surface)]"
    >
      {children}
    </div>
  );
}

export function ChatContentLine({
  line,
  tokens,
  wrapLongLines,
  contentSearchQuery,
  activeMatchId,
  contentSearchUnitId,
  hunkIndex,
  onHunkHover,
  pill,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
  wrapLongLines: boolean;
  contentSearchQuery: string;
  activeMatchId: string | null;
  contentSearchUnitId: string;
  hunkIndex?: number;
  onHunkHover?: (hunkIndex: number) => void;
  pill?: ReactNode;
}) {
  const lineType = getChatLineType(line);
  const lineNumber = getChatLineNumber(line);
  const altLineNumber = line.type === "context" ? line.oldLineNum : undefined;

  return (
    <div
      data-line={lineNumber ?? undefined}
      data-alt-line={altLineNumber}
      data-line-type={lineType}
      data-line-index={getDiffLineIndex(line)}
      onMouseEnter={
        onHunkHover != null && hunkIndex != null
          ? () => onHunkHover(hunkIndex)
          : undefined
      }
      className={`diff-content-cell relative min-h-[var(--diffs-line-height)] pr-3 pl-2 ${
        wrapLongLines
          ? "block min-w-0 whitespace-pre-wrap break-words py-[calc((var(--diffs-line-height)-1em)/2)]"
          : "flex min-w-max items-center whitespace-pre"
      }`}
    >
      <DiffLineContent
        line={line}
        tokens={tokens}
        contentSearchQuery={contentSearchQuery}
        activeMatchId={activeMatchId}
        contentSearchLineId={`${contentSearchUnitId}:line:${line.tokenIndex}`}
      />
      {pill}
    </div>
  );
}

export function ChatCollapsedRow({
  section,
  onExpand,
}: {
  section: CollapsedContext;
  onExpand: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      data-separator="simple"
      onClick={onExpand}
      aria-label={`Expand ${section.lineCount} unmodified lines`}
      title={`${section.lineCount} unmodified lines`}
      className="diff-content-cell flex min-h-[var(--diffs-line-height)] cursor-pointer items-center justify-start border-0 bg-[var(--codex-diffs-separator-surface)] p-0 text-left font-[inherit] text-[inherit] leading-[inherit] text-muted-foreground/60 transition-colors hover:text-foreground"
    >
      <DiffCollapsedContentLabel
        lineCount={section.lineCount}
        stickyLeft="var(--diffs-column-number-width)"
      />
    </Button>
  );
}

export function ChatGutterColumn({
  rows,
  rowCount,
  onExpandGap,
  canExpandGaps,
}: {
  rows: Array<{ kind: string; key: string; line?: DiffLine; gap?: InterHunkGap; gapIndex?: number; section?: CollapsedContext }>;
  rowCount: number;
  onExpandGap: (gapIndex: number, gap: InterHunkGap, direction: ExpandDirection) => void;
  canExpandGaps: boolean;
}) {
  return (
    <div
      data-gutter=""
      style={{ gridColumn: "1", gridRow: `1 / span ${rowCount}` }}
      className="sticky left-0 z-10 grid bg-[var(--diffs-bg)] [grid-template-rows:subgrid]"
    >
      {rows.map((row) => {
        if (row.kind === "line" || row.kind === "expanded-gap-line") {
          return <ChatGutterLine key={row.key} line={row.line!} />;
        }
        if (row.kind === "gap" && canExpandGaps) {
          return (
            <ChatGutterSeparatorLine key={row.key}>
              <DiffGapGutterControls
                gap={row.gap!}
                onExpand={(direction) => onExpandGap(row.gapIndex!, row.gap!, direction)}
              />
            </ChatGutterSeparatorLine>
          );
        }
        if (row.kind === "collapsed") {
          return (
            <ChatGutterSeparatorLine key={row.key}>
              <DiffCollapsedGutterIcon />
            </ChatGutterSeparatorLine>
          );
        }
        // gap without expand capability
        return <ChatGutterSeparatorLine key={row.key} />;
      })}
    </div>
  );
}
