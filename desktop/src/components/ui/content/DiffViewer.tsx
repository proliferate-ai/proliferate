import { useMemo, useState, type CSSProperties } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { useResolvedMode } from "@/hooks/theme/use-theme";
import { useDiffHighlight } from "@/hooks/ui/use-diff-highlight";
import type {
  CollapsedContext,
  DiffLine,
  DiffHunk,
  ParsedPatch,
} from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/highlighting";

interface DiffViewerProps {
  patch: string;
  filePath?: string;
  className?: string;
  viewportClassName?: string;
  wrapLongLines?: boolean;
  variant?: "default" | "chat";
}

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
        <TokenizedContent line={line} tokens={tokens} />
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
      {hunk.items.map((item, i) => {
        if ("kind" in item && item.kind === "collapsed") {
          return (
            <CollapsedSection
              key={`c-${i}`}
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

type ChatDiffRow =
  | { kind: "line"; key: string; line: DiffLine }
  | { kind: "collapsed"; key: string; section: CollapsedContext };

const CHAT_DIFF_PRE_STYLE = {
  color: "var(--diffs-fg)",
  backgroundColor: "var(--codex-diffs-surface)",
  "--diffs-bg": "var(--codex-diffs-surface)",
  "--diffs-addition-color": "var(--color-diff-added)",
  "--diffs-deletion-color": "var(--color-diff-deleted)",
  "--diffs-min-number-column-width-default": "2ch",
} as CSSProperties;

const CHAT_DIFF_CODE_STYLE = {
  "--diffs-column-content-width": "700px",
  "--diffs-column-width": "736px",
  "--diffs-column-number-width": "36px",
} as CSSProperties;

function getChatLineType(line: DiffLine): "context" | "change-addition" | "change-deletion" {
  switch (line.type) {
    case "added":
      return "change-addition";
    case "removed":
      return "change-deletion";
    case "context":
      return "context";
  }
}

function getChatLineNumber(line: DiffLine): number | null {
  if (line.type === "removed") {
    return line.oldLineNum;
  }
  return line.newLineNum ?? line.oldLineNum;
}

function getChatLineIndex(line: DiffLine): string {
  return `${line.oldLineNum ?? ""},${line.newLineNum ?? ""}`;
}

function getChatRows(
  parsed: ParsedPatch,
  expandedCollapsedKeys: Set<string>,
): ChatDiffRow[] {
  const rows: ChatDiffRow[] = [];

  parsed.hunks.forEach((hunk, hunkIndex) => {
    hunk.items.forEach((item, itemIndex) => {
      const key = `${hunkIndex}-${itemIndex}`;
      if ("kind" in item && item.kind === "collapsed") {
        if (expandedCollapsedKeys.has(key)) {
          item.lines.forEach((line) => {
            rows.push({
              kind: "line",
              key: `${key}-${line.tokenIndex}`,
              line,
            });
          });
        } else {
          rows.push({ kind: "collapsed", key, section: item });
        }
        return;
      }

      const line = item as DiffLine;
      rows.push({
        kind: "line",
        key: `${key}-${line.tokenIndex}`,
        line,
      });
    });
  });

  return rows;
}

function ChatGutterCell({ line }: { line: DiffLine }) {
  const lineType = getChatLineType(line);
  const lineNumber = getChatLineNumber(line);

  return (
    <div
      data-line-type={lineType}
      data-column-number={lineNumber ?? undefined}
      data-line-index={getChatLineIndex(line)}
      className="diff-gutter-cell box-border flex min-h-[var(--diffs-line-height)] w-[var(--diffs-column-number-width)] min-w-[var(--diffs-column-number-width)] items-center justify-end px-2 text-right tabular-nums"
    >
      <span data-line-number-content="">{lineNumber ?? ""}</span>
    </div>
  );
}

function ChatContentCell({
  line,
  tokens,
}: {
  line: DiffLine;
  tokens: HighlightedToken[][] | null;
}) {
  const lineType = getChatLineType(line);
  const lineNumber = getChatLineNumber(line);
  const altLineNumber = line.type === "context" ? line.oldLineNum : undefined;

  return (
    <div
      data-line={lineNumber ?? undefined}
      data-alt-line={altLineNumber}
      data-line-type={lineType}
      data-line-index={getChatLineIndex(line)}
      className="diff-content-cell flex min-h-[var(--diffs-line-height)] min-w-max items-center pr-3 whitespace-pre"
    >
      <TokenizedContent line={line} tokens={tokens} />
    </div>
  );
}

function ChatCollapsedRow({
  section,
  onExpand,
}: {
  section: CollapsedContext;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      data-separator="simple"
      onClick={onExpand}
      aria-label={`Show ${section.lineCount} unmodified lines`}
      title={`${section.lineCount} unmodified lines`}
      className="diff-content-cell flex min-h-[var(--diffs-line-height)] cursor-pointer items-center border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] leading-[inherit]"
    />
  );
}

function ChatDiffViewer({
  parsed,
  tokens,
  className,
  viewportClassName,
}: {
  parsed: ParsedPatch;
  tokens: HighlightedToken[][] | null;
  className?: string;
  viewportClassName?: string;
}) {
  const resolvedMode = useResolvedMode();
  const [expandedCollapsedKeys, setExpandedCollapsedKeys] = useState<Set<string>>(
    new Set(),
  );
  const rows = useMemo(
    () => getChatRows(parsed, expandedCollapsedKeys),
    [parsed, expandedCollapsedKeys],
  );
  const rowSpan = Math.max(rows.length, 1);

  const expandCollapsedRow = (key: string) => {
    setExpandedCollapsedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return (
    <div className={`thread-diff-virtualized ${className ?? ""}`}>
      <div
        style={{ overscrollBehavior: "none" }}
        className={`relative [contain:content] composer-diff-simple-line overflow-auto ${
          viewportClassName ?? ""
        }`}
      >
        <pre
          data-diff=""
          data-theme-type={resolvedMode === "dark" ? "dark" : "light"}
          data-indicators="bars"
          data-background=""
          data-diff-type="single"
          data-overflow="scroll"
          data-interactive-lines=""
          data-interactive-line-numbers=""
          tabIndex={0}
          style={CHAT_DIFF_PRE_STYLE}
          className="m-0 w-full min-w-max bg-[var(--codex-diffs-surface)] p-0 font-[family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] text-[color:var(--diffs-fg)]"
        >
          <code
            data-code=""
            data-unified=""
            style={CHAT_DIFF_CODE_STYLE}
            className="grid grid-cols-[var(--diffs-column-number-width)_minmax(max-content,1fr)]"
          >
            <div
              data-gutter=""
              style={{ gridRow: `span ${rowSpan}` }}
              className="grid auto-rows-[var(--diffs-line-height)]"
            >
              {rows.map((row) =>
                row.kind === "line" ? (
                  <ChatGutterCell key={`g-${row.key}`} line={row.line} />
                ) : (
                  <div
                    key={`g-${row.key}`}
                    data-separator="simple"
                    className="diff-gutter-cell min-h-[var(--diffs-line-height)]"
                  />
                ),
              )}
            </div>
            <div
              data-content=""
              style={{ gridRow: `span ${rowSpan}` }}
              className="grid auto-rows-[var(--diffs-line-height)]"
            >
              {rows.map((row) =>
                row.kind === "line" ? (
                  <ChatContentCell
                    key={`c-${row.key}`}
                    line={row.line}
                    tokens={tokens}
                  />
                ) : (
                  <ChatCollapsedRow
                    key={`c-${row.key}`}
                    section={row.section}
                    onExpand={() => expandCollapsedRow(row.key)}
                  />
                ),
              )}
            </div>
          </code>
        </pre>
      </div>
    </div>
  );
}

export function DiffViewer({
  patch,
  filePath,
  className,
  viewportClassName,
  wrapLongLines = false,
  variant = "default",
}: DiffViewerProps) {
  const { parsed, tokens } = useDiffHighlight(patch, filePath);
  if (variant === "chat") {
    return (
      <ChatDiffViewer
        parsed={parsed}
        tokens={tokens}
        className={className}
        viewportClassName={viewportClassName}
      />
    );
  }

  const rootClass =
    "font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]";

  return (
    <AutoHideScrollArea
      className={`${rootClass} ${className ?? ""}`}
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
          variant={variant}
        />
      ))}
    </AutoHideScrollArea>
  );
}
