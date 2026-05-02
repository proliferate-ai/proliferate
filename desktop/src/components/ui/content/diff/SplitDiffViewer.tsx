import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import type { DiffLine, ParsedPatch } from "@/lib/domain/files/diff-parser";
import type { HighlightedToken } from "@/lib/infra/highlighting";

type SplitDiffRow =
  | { key: string; oldLine: null; newLine: null; label: string }
  | { key: string; oldLine: DiffLine | null; newLine: DiffLine | null; label: null };

function tokenContent(line: DiffLine, tokens: HighlightedToken[][] | null) {
  const lineTokens = tokens?.[line.tokenIndex];
  if (!lineTokens) {
    return line.content || " ";
  }
  return lineTokens.map((token, index) => (
    <span key={index} style={token.color ? { color: token.color } : undefined}>
      {token.content}
    </span>
  ));
}

function SplitCell({
  line,
  tokens,
  side,
}: {
  line: DiffLine | null;
  tokens: HighlightedToken[][] | null;
  side: "old" | "new";
}) {
  if (!line) {
    return <div className="min-h-[var(--readable-code-line-height)] border-l border-border/40" />;
  }
  const lineNumber = side === "old"
    ? line.oldLineNum
    : line.newLineNum;
  const bg = line.type === "added"
    ? "bg-[var(--color-diff-added-bg)]"
    : line.type === "removed"
      ? "bg-[var(--color-diff-deleted-bg)]"
      : "";
  return (
    <div className={`grid min-h-[var(--readable-code-line-height)] grid-cols-[4ch_minmax(0,1fr)] border-l border-border/40 ${bg}`}>
      <span className="select-none pr-1 text-right text-[10px] text-muted-foreground/40">
        {lineNumber ?? ""}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-words px-2">
        {tokenContent(line, tokens)}
      </span>
    </div>
  );
}

export function SplitDiffViewer({
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
  const rows: SplitDiffRow[] = [];
  parsed.hunks.forEach((hunk, hunkIndex) => {
    hunk.items.forEach((item, itemIndex) => {
      if ("kind" in item && item.kind === "collapsed") {
        rows.push({
          key: `collapsed-${hunkIndex}-${itemIndex}`,
          oldLine: null,
          newLine: null,
          label: `${item.lineCount} unmodified lines`,
        });
        return;
      }
      const line = item as DiffLine;
      rows.push({
        key: `line-${line.tokenIndex}`,
        oldLine: line.type === "added" ? null : line,
        newLine: line.type === "removed" ? null : line,
        label: null,
      });
    });
  });

  return (
    <AutoHideScrollArea
      className={`font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] ${className ?? ""}`}
      viewportClassName={viewportClassName}
      allowHorizontal={false}
    >
      <div className="grid min-w-0 grid-cols-2">
        {rows.map((row) =>
          row.label ? (
            <div
              key={row.key}
              className="col-span-2 border-y border-border/50 bg-muted/20 px-3 py-1 text-center text-[10px] text-muted-foreground"
            >
              {row.label}
            </div>
          ) : (
            <div key={row.key} className="contents">
              <SplitCell line={row.oldLine} tokens={tokens} side="old" />
              <SplitCell line={row.newLine} tokens={tokens} side="new" />
            </div>
          )
        )}
      </div>
    </AutoHideScrollArea>
  );
}
