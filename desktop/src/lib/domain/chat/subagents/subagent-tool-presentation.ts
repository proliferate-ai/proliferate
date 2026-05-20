import type { ToolCallItem, ToolResultTextContentPart } from "@anyharness/sdk";
import type { SubagentExecutionState } from "@/lib/domain/chat/subagents/subagent-launch";

type ToolNameOwner = Pick<ToolCallItem, "nativeToolName">;

export type SubagentMcpReceiptAction =
  | "send"
  | "wake"
  | "status"
  | "read"
  | "search"
  | "close";

export interface SubagentMcpReceiptPresentation {
  action: SubagentMcpReceiptAction;
  actionLabel: string;
  title: string;
  subagentId: string | null;
  sessionLinkId: string | null;
  childSessionId: string | null;
  statusLabel: string | null;
  detailLabel: string | null;
  openSessionAllowed: boolean;
}

export function formatSubagentMcpActionLabel(toolName: string | null | undefined): string | null {
  switch (normalizeToolName(toolName)) {
    case "mcp__subagents__send_subagent_message":
      return "Sent subagent message";
    case "mcp__subagents__schedule_subagent_wake":
      return "Scheduled subagent wake";
    case "mcp__subagents__get_subagent_status":
      return "Checked subagent status";
    case "mcp__subagents__read_subagent_events":
      return "Read subagent events";
    case "mcp__subagents__read_subagent_latest_turns":
      return "Read subagent turns";
    case "mcp__subagents__search_subagent_transcript":
      return "Searched subagent transcript";
    case "mcp__subagents__close_subagent":
      return "Closed subagent";
    default:
      return null;
  }
}

export function formatSubagentHeaderVerb({
  item,
  executionState,
  isRunning,
}: {
  item: ToolNameOwner;
  executionState: SubagentExecutionState;
  isRunning: boolean;
}): string {
  const toolName = normalizeToolName(item.nativeToolName);
  if (toolName === "mcp__subagents__send_subagent_message") {
    return isRunning ? "Sending message to subagent" : "Message sent to subagent";
  }
  if (toolName === "mcp__subagents__schedule_subagent_wake") {
    return isRunning ? "Scheduling subagent wake" : "Subagent wake scheduled";
  }
  if (toolName === "mcp__subagents__get_subagent_status") {
    return isRunning ? "Checking subagent status" : "Subagent status checked";
  }
  if (toolName === "mcp__subagents__read_subagent_events") {
    return isRunning ? "Reading subagent events" : "Subagent events read";
  }
  if (toolName === "mcp__subagents__read_subagent_latest_turns") {
    return isRunning ? "Reading subagent turns" : "Subagent turns read";
  }
  if (toolName === "mcp__subagents__search_subagent_transcript") {
    return isRunning ? "Searching subagent transcript" : "Subagent transcript searched";
  }
  if (toolName === "mcp__subagents__close_subagent") {
    return isRunning ? "Closing subagent" : "Subagent closed";
  }
  if (executionState === "failed") {
    return "Subagent launch failed";
  }
  return isRunning ? "Creating subagent" : "Subagent created";
}

export function isSubagentProvisioningAction(item: ToolNameOwner): boolean {
  return isSubagentCreationAction(item);
}

export function isSubagentCreationAction(item: ToolNameOwner): boolean {
  // Only the product-MCP create_subagent receipt collapses into a creation
  // group. Native Agent calls render their nested transcript via the normal
  // grouped-tool path and must not be flattened to a "Created subagent" row.
  return normalizeToolName(item.nativeToolName) === "mcp__subagents__create_subagent";
}

export function deriveSubagentMcpReceiptPresentation(
  item: ToolCallItem,
): SubagentMcpReceiptPresentation | null {
  const action = receiptActionFromToolName(item.nativeToolName);
  if (!action) {
    return null;
  }

  const rawInput = isRecord(item.rawInput) ?? {};
  const rawOutput = isRecord(item.rawOutput) ?? parseToolResultJsonObject(item) ?? {};
  const subagentId =
    readStringField(rawOutput, "subagentId")
    ?? readStringField(rawInput, "subagentId")
    ?? readStringField(rawInput, "subagent_id");
  const sessionLinkId =
    readStringField(rawOutput, "sessionLinkId")
    ?? readStringField(rawInput, "sessionLinkId")
    ?? readStringField(rawInput, "session_link_id");
  const childSessionId =
    readStringField(rawOutput, "childSessionId")
    ?? readStringField(rawInput, "childSessionId")
    ?? readStringField(rawInput, "child_session_id");
  const title =
    readStringField(rawOutput, "label")
    ?? readStringField(rawInput, "label")
    ?? subagentId
    ?? "Subagent";
  const rawStatus =
    readStringField(rawOutput, "status")
    ?? readStringField(rawOutput, "promptStatus");
  const statusLabel = action === "status" || rawStatus
    ? formatStatusLabel(rawStatus)
    : null;
  const detailLabel = detailLabelForAction(action, rawOutput, statusLabel);

  return {
    action,
    actionLabel: actionLabel(action, item.status === "in_progress"),
    title,
    subagentId,
    sessionLinkId,
    childSessionId,
    statusLabel,
    detailLabel,
    openSessionAllowed: action !== "close" && normalizeStatus(rawStatus) !== "closed",
  };
}

function normalizeToolName(toolName: string | null | undefined): string {
  return toolName?.trim().toLowerCase() ?? "";
}

function receiptActionFromToolName(toolName: string | null | undefined): SubagentMcpReceiptAction | null {
  switch (normalizeToolName(toolName)) {
    case "mcp__subagents__send_subagent_message":
      return "send";
    case "mcp__subagents__schedule_subagent_wake":
      return "wake";
    case "mcp__subagents__get_subagent_status":
      return "status";
    case "mcp__subagents__read_subagent_latest_turns":
      return "read";
    case "mcp__subagents__search_subagent_transcript":
      return "search";
    case "mcp__subagents__close_subagent":
      return "close";
    default:
      return null;
  }
}

function actionLabel(action: SubagentMcpReceiptAction, running: boolean): string {
  switch (action) {
    case "send":
      return running ? "Sending message to subagent" : "Sent message to subagent";
    case "wake":
      return running ? "Scheduling wake for subagent" : "Scheduled wake for subagent";
    case "status":
      return running ? "Checking subagent" : "Checked subagent";
    case "read":
      return running ? "Reading subagent turns" : "Read subagent turns";
    case "search":
      return running ? "Searching subagent" : "Searched subagent";
    case "close":
      return running ? "Closing subagent" : "Closed subagent";
  }
}

function detailLabelForAction(
  action: SubagentMcpReceiptAction,
  output: Record<string, unknown>,
  statusLabel: string | null,
): string | null {
  switch (action) {
    case "send":
      return statusLabel;
    case "wake":
      return readBooleanField(output, "alreadyScheduled") ? "Already scheduled" : "Wake scheduled";
    case "status":
      return statusLabel;
    case "read": {
      const turns = output.turns;
      return Array.isArray(turns)
        ? `${turns.length} ${turns.length === 1 ? "turn" : "turns"}`
        : null;
    }
    case "search": {
      const matches = output.matches;
      return Array.isArray(matches)
        ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}`
        : null;
    }
    case "close":
      return readBooleanField(output, "alreadyClosed") ? "Already closed" : null;
  }
}

function formatStatusLabel(status: string | null): string | null {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    return null;
  }
  switch (normalized) {
    case "running":
      return "Working";
    case "idle":
      return "Idle";
    case "completed":
      return "Done";
    case "errored":
      return "Failed";
    case "starting":
      return "Starting";
    case "queued":
      return "Queued";
    case "closed":
      return "Closed";
    default:
      return normalized.replace(/\b\w/gu, (char) => char.toUpperCase());
  }
}

function normalizeStatus(status: string | null | undefined): string {
  return status
    ?.replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase() ?? "";
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

function readBooleanField(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}
