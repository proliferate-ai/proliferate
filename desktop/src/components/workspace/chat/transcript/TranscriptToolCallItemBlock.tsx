import { useState } from "react";
import type {
  FileChangeContentPart,
  FileReadContentPart,
  TerminalOutputContentPart,
  ToolCallContentPart,
  ToolCallItem,
  ToolResultTextContentPart,
} from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { BashCommandCall } from "@/components/workspace/chat/tool-calls/BashCommandCall";
import { CoworkArtifactToolActionRow } from "@/components/workspace/chat/tool-calls/CoworkArtifactToolActionRow";
import { CoworkCodingToolActionRow } from "@/components/workspace/chat/tool-calls/cowork/CoworkCodingToolActionRow";
import { FileChangeCall } from "@/components/workspace/chat/tool-calls/FileChangeCall";
import { FileReadCall } from "@/components/workspace/chat/tool-calls/FileReadCall";
import { GenericToolResultRow } from "@/components/workspace/chat/tool-calls/GenericToolResultRow";
import { SkillsToolResultRow } from "@/components/workspace/chat/tool-calls/SkillsToolResultRow";
import { SubagentToolActionRow } from "@/components/workspace/chat/tool-calls/SubagentToolActionRow";
import { useOpenCoworkCodingSession } from "@/hooks/cowork/workflows/use-open-cowork-coding-session";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { deriveSubagentMcpReceiptPresentation } from "@/lib/domain/chat/subagents/subagent-tool-presentation";
import { deriveSkillsToolResultPresentation } from "@/lib/domain/chat/tools/skills-tool-result";
import { describeToolCallDisplay } from "@/lib/domain/chat/tools/tool-call-display";
import { normalizeToolResultText } from "@/lib/domain/chat/tools/tool-result-text";
import { CHAT_VISIBLE_FILE_CHANGE_LIMIT } from "@/lib/domain/workspaces/changes/diff-display-policy";
import { ToolKindIcon } from "./TranscriptToolKindIcon";

export function TranscriptToolCallItemBlock({
  item,
  workspaceId,
  onOpenArtifact,
}: {
  item: ToolCallItem;
  workspaceId: string | null;
  onOpenArtifact: (workspaceId: string, artifactId: string) => void;
}) {
  const openCodingSession = useOpenCoworkCodingSession();
  const { selectWorkspace } = useWorkspaceSelection();
  const [showAllFileChanges, setShowAllFileChanges] = useState(false);

  if (
    item.semanticKind === "cowork_artifact_create"
    || item.semanticKind === "cowork_artifact_update"
  ) {
    return (
      <CoworkArtifactToolActionRow
        item={item}
        onOpenArtifact={
          workspaceId
            ? (artifactId) => onOpenArtifact(workspaceId, artifactId)
            : undefined
        }
      />
    );
  }

  if (item.semanticKind === "cowork_coding") {
    return (
      <CoworkCodingToolActionRow
        item={item}
        onOpenCodingSession={(input) => { void openCodingSession(input); }}
        onOpenWorkspace={(targetWorkspaceId) => {
          void selectWorkspace(targetWorkspaceId, { force: true });
        }}
      />
    );
  }

  const fileChanges = item.contentParts.filter(
    (part): part is FileChangeContentPart => part.type === "file_change",
  );
  const fileReads = item.contentParts.filter(
    (part): part is FileReadContentPart => part.type === "file_read",
  );
  const terminalParts = item.contentParts.filter(
    (part): part is TerminalOutputContentPart => part.type === "terminal_output",
  );
  const toolCallPart = item.contentParts.find(
    (part): part is ToolCallContentPart => part.type === "tool_call",
  );
  const toolResultText = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text)
    .join("\n\n");
  const normalizedResultText = normalizeToolResultText(toolResultText);
  const toolName = toolCallPart?.title ?? item.title ?? item.nativeToolName ?? "Tool call";
  const rawInput = isRecord(item.rawInput);
  const bashDescription = readString(rawInput?.description) ?? undefined;
  const bashCommand = readString(rawInput?.command) ?? toolName;
  const fallbackDisplay = describeToolCallDisplay(item, toolName);
  const rows: React.ReactNode[] = [];
  const status = mapStatus(item.status);
  const skillsToolResult = deriveSkillsToolResultPresentation(item, normalizedResultText);
  const subagentReceipt = deriveSubagentMcpReceiptPresentation(item);
  const visibleFileChanges = showAllFileChanges
    ? fileChanges
    : fileChanges.slice(0, CHAT_VISIBLE_FILE_CHANGE_LIMIT);
  const hiddenFileChangeCount = fileChanges.length - visibleFileChanges.length;
  const canToggleFileChanges = fileChanges.length > CHAT_VISIBLE_FILE_CHANGE_LIMIT;

  visibleFileChanges.forEach((part, idx) => {
    rows.push(
      <FileChangeCall
        key={`file-change-${idx}`}
        operation={part.operation}
        path={part.path}
        workspacePath={part.workspacePath}
        basename={part.basename}
        newPath={part.newPath}
        newWorkspacePath={part.newWorkspacePath}
        newBasename={part.newBasename}
        additions={part.additions}
        deletions={part.deletions}
        patch={part.patch}
        preview={part.preview}
        status={status}
        contentSearchUnitId={`diff:tool:${item.itemId}:file-change:${idx}`}
      />,
    );
  });
  if (canToggleFileChanges) {
    rows.push(
      <FileChangesToggleRow
        key="file-change-toggle"
        expanded={showAllFileChanges}
        hiddenCount={hiddenFileChangeCount}
        onToggle={() => setShowAllFileChanges((value) => !value)}
      />,
    );
  }

  fileReads.forEach((part, idx) => {
    rows.push(
      <FileReadCall
        key={`file-read-${idx}`}
        path={part.path}
        workspacePath={part.workspacePath}
        basename={part.basename}
        line={part.line}
        scope={part.scope}
        startLine={part.startLine}
        endLine={part.endLine}
        preview={part.preview ?? (normalizedResultText || undefined)}
        status={status}
      />,
    );
  });

  if (terminalParts.length > 0) {
    const output = terminalParts
      .filter((part) => part.event === "output" && part.data)
      .map((part) => part.data ?? "")
      .join("");
    rows.push(
      <BashCommandCall
        key="terminal"
        command={bashCommand}
        description={bashDescription}
        output={output || (typeof item.rawOutput === "string" ? item.rawOutput : undefined)}
        status={status}
        duration={formatToolDuration(item)}
      />,
    );
  }

  if (rows.length === 0 && normalizedResultText) {
    if (item.nativeToolName === "Bash" || item.toolKind === "execute") {
      rows.push(
        <BashCommandCall
          key="terminal-result"
          command={bashCommand}
          description={bashDescription}
          output={normalizedResultText}
          status={status}
          duration={formatToolDuration(item)}
        />,
      );
    } else if (item.nativeToolName === "Read" || item.toolKind === "read") {
      const fallbackReadPath = deriveReadPath(item, toolName);
      rows.push(
        <FileReadCall
          key="read-result"
          path={fallbackReadPath}
          basename={fallbackReadPath.split("/").pop() ?? fallbackReadPath}
          scope="unknown"
          preview={normalizedResultText}
          status={status}
        />,
      );
    }
  }

  if (rows.length === 0 && skillsToolResult) {
    rows.push(
      <SkillsToolResultRow
        key="skills-result"
        presentation={skillsToolResult}
        status={status}
      />,
    );
  }

  if (rows.length === 0 && subagentReceipt) {
    rows.push(
      <SubagentToolActionRow
        key="subagent-receipt"
        presentation={subagentReceipt}
        status={status}
        resultText={normalizedResultText}
      />,
    );
  }

  if (rows.length === 0 && normalizedResultText) {
    rows.push(
      <GenericToolResultRow
        key="result"
        icon={<ToolKindIcon iconKey={fallbackDisplay.iconKey} />}
        label={<span className="font-[460] text-foreground/90">{fallbackDisplay.label}</span>}
        status={status}
        hint={fallbackDisplay.hint}
        resultText={normalizedResultText}
      />,
    );
  }

  if (rows.length === 0) {
    rows.push(
      <GenericToolResultRow
        key="tool"
        icon={<ToolKindIcon iconKey={fallbackDisplay.iconKey} />}
        label={<span className="font-[460] text-foreground/90">{fallbackDisplay.label}</span>}
        status={status}
        hint={fallbackDisplay.hint}
      />,
    );
  }

  if (rows.length === 1) {
    return <>{rows[0]}</>;
  }

  const hasOnlyFileChangeRows =
    fileChanges.length > 0
    && fileReads.length === 0
    && terminalParts.length === 0;
  return (
    <div className={hasOnlyFileChangeRows ? "flex flex-col" : "space-y-1.5"}>
      {rows}
    </div>
  );
}

function FileChangesToggleRow({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className="h-7 w-fit justify-start rounded-md px-1.5 text-chat font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {expanded ? "Show less" : `Show ${hiddenCount} more`}
    </Button>
  );
}

function deriveReadPath(item: ToolCallItem, fallback: string): string {
  const rawInput = isRecord(item.rawInput);
  const fromInput =
    readString(rawInput?.file_path) ??
    readString(rawInput?.path);
  if (fromInput) return fromInput;
  return fallback.startsWith("Read ") ? fallback.slice(5) : fallback;
}

function isRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapStatus(
  status: string,
): "running" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function formatToolDuration(item: ToolCallItem): string | undefined {
  const rawItem = isRecord(item);
  const startedAtValue =
    readString(rawItem?.startedAt)
    ?? readString(rawItem?.timestamp);
  if (!startedAtValue) {
    return undefined;
  }

  const startedAt = Date.parse(startedAtValue);
  if (!Number.isFinite(startedAt)) {
    return undefined;
  }

  const completedAtValue = readString(rawItem?.completedAt);
  const completedAt = completedAtValue ? Date.parse(completedAtValue) : Date.now();
  if (!Number.isFinite(completedAt) || completedAt < startedAt) {
    return undefined;
  }

  const elapsedSeconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
  if (elapsedSeconds < 60) {
    return `for ${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return seconds === 0 ? `for ${minutes}m` : `for ${minutes}m ${seconds}s`;
}
