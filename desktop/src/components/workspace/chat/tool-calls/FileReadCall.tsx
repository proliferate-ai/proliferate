import { FileText } from "@/components/ui/icons";
import { HighlightedCodePanel } from "@/components/ui/content/HighlightedCodePanel";
import { ToolFileChip } from "./ToolFileChip";
import { ToolCallBlock, TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "./ToolCallBlock";
import type { FileReadScope } from "@anyharness/sdk";

interface FileReadCallProps {
  path: string;
  workspacePath?: string | null;
  basename?: string | null;
  line?: number | null;
  scope?: FileReadScope | null;
  startLine?: number | null;
  endLine?: number | null;
  preview?: string | null;
  status?: "running" | "completed" | "failed";
  duration?: string;
  defaultExpanded?: boolean;
}

export function FileReadCall({
  path,
  workspacePath = null,
  basename = null,
  line = null,
  scope = null,
  startLine = null,
  endLine = null,
  preview,
  status = "completed",
  duration,
  defaultExpanded = false,
}: FileReadCallProps) {
  const resolvedBasename = basename || extractBasename(path);
  const isPartialRead = scope === "line" || scope === "range";
  const scopeLabel = formatScopeLabel(scope, line, startLine, endLine);
  const previewPanel = isPartialRead && preview
    ? (
      <div className="overflow-hidden rounded-md border border-border/60 bg-muted/25">
        <HighlightedCodePanel
          code={preview}
          filename={workspacePath ?? path}
          showLanguageLabel={false}
          showLineNumbers
          lineNumberStart={resolvePreviewStartLine(line, startLine)}
          className="border-0 bg-transparent"
          contentClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
        />
      </div>
    )
    : null;
  const fileLabel = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 font-[460] text-foreground/90">
        {status === "running" ? "Reading" : "Read"}
      </span>
      <ToolFileChip
        basename={resolvedBasename}
        pathLabel={workspacePath ?? path}
        workspacePath={workspacePath}
      />
      {scopeLabel && <span className="truncate text-[12px] text-faint">{scopeLabel}</span>}
    </div>
  );

  return (
    <ToolCallBlock
      icon={<FileText />}
      name={fileLabel}
      status={status}
      duration={duration}
      defaultExpanded={defaultExpanded}
      expandable={isPartialRead && !!preview}
    >
      {previewPanel}
    </ToolCallBlock>
  );
}

function formatScopeLabel(
  scope: FileReadScope | null,
  line: number | null,
  startLine: number | null,
  endLine: number | null,
): string | null {
  if (scope === "line") {
    const targetLine = line ?? startLine ?? endLine;
    return targetLine ? `line ${targetLine}` : "line read";
  }
  if (scope === "range") {
    if (startLine && endLine) {
      return `lines ${startLine}-${endLine}`;
    }
    if (startLine) {
      return `from line ${startLine}`;
    }
    return "range read";
  }
  return null;
}

function extractBasename(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function resolvePreviewStartLine(
  line: number | null,
  startLine: number | null,
): number {
  return line ?? startLine ?? 1;
}
