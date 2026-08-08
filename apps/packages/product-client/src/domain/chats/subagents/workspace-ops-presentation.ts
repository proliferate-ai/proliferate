import type { ToolCallItem, ToolResultTextContentPart } from "@anyharness/sdk";

/**
 * A workspace an agent created, as one transcript line.
 *
 * ADR §4 locks the shape: "Created workspace billing-hotfix-dispatch —
 * proliferate · worktree from main · Open". One line, the same weight as every
 * other quiet tool receipt, with an inline Open that switches to it.
 */
export interface WorkspaceOpsReceiptPresentation {
  /** The workspace's name, as the human will see it in the sidebar. */
  name: string;
  workspaceId: string | null;
  /** "proliferate · worktree from main" */
  provenanceLabel: string | null;
  /** A run script the agent configured, if it configured one. */
  runScript: string | null;
  running: boolean;
  failed: boolean;
}

export function deriveWorkspaceOpsReceipt(
  item: ToolCallItem,
): WorkspaceOpsReceiptPresentation | null {
  if (normalizeToolName(item.nativeToolName) !== "mcp__subagents__spawn_workspace") {
    return null;
  }
  const input = isRecord(item.rawInput) ?? {};
  const output = isRecord(item.rawOutput) ?? parseToolResultJsonObject(item) ?? {};
  const name =
    readStringField(output, "workspaceName")
    ?? readStringField(output, "name")
    ?? readStringField(input, "name")
    ?? readStringField(output, "branchName")
    ?? "workspace";
  const mode = readStringField(output, "mode") ?? readStringField(input, "mode");
  const branchName = readStringField(output, "branchName") ?? readStringField(input, "branchName");
  const baseBranch =
    readStringField(output, "baseBranch")
    ?? readStringField(input, "baseBranch")
    ?? readStringField(input, "base_branch");
  // "worktree from main" — the mode and what it came off, which is the only
  // provenance that changes how the workspace behaves.
  const modeLabel = mode
    ? baseBranch ? `${mode} from ${baseBranch}` : mode
    : branchName;
  const provenanceLabel = [readStringField(output, "repoName"), modeLabel]
    .filter((part): part is string => !!part)
    .join(" · ") || null;

  return {
    name,
    workspaceId: readStringField(output, "workspaceId"),
    provenanceLabel,
    runScript:
      readStringField(output, "runScript")
      ?? readStringField(output, "setupScript")
      ?? readStringField(input, "runScript"),
    running: item.status === "in_progress",
    failed: item.status === "failed",
  };
}

function normalizeToolName(toolName: string | null | undefined): string {
  return toolName?.trim().toLowerCase() ?? "";
}

function parseToolResultJsonObject(item: ToolCallItem): Record<string, unknown> | null {
  const text = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .filter((textPart) => textPart.length > 0)
    .join("\n\n");
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  if (typeof field !== "string") {
    return null;
  }
  const trimmed = field.trim();
  return trimmed.length > 0 ? trimmed : null;
}
