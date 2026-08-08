import type { ToolCallItem, ToolResultTextContentPart } from "@anyharness/sdk";
import type { SubagentExecutionState } from "./subagent-launch";

type ToolNameOwner = Pick<ToolCallItem, "nativeToolName">;

export type SubagentMcpReceiptAction =
  | "send"
  | "wake"
  | "status"
  | "read"
  | "search"
  | "promote"
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
  wakeScheduled: boolean;
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
    case "mcp__subagents__promote_subagent":
      return "Promoted subagent";
    case "mcp__subagents__close_agent":
    case "mcp__subagents__close_subagent":
      return "Closed agent";
    case "mcp__subagents__spawn_agent":
      return "Spawned agent";
    case "mcp__subagents__send_agent_message":
      return "Sent agent message";
    case "mcp__subagents__list_agents":
      return "Listed agents";
    case "mcp__subagents__read_agent_transcript":
      return "Read agent transcript";
    case "mcp__subagents__schedule_agent_wake":
      return "Scheduled agent wake";
    case "mcp__subagents__get_agent_config_options":
      return "Read agent config options";
    case "mcp__subagents__configure_agent":
      return "Configured agent";
    case "mcp__subagents__get_workspace_options":
      return "Read workspace options";
    case "mcp__subagents__spawn_workspace":
      return "Spawned workspace";
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
  if (toolName === "mcp__subagents__promote_subagent") {
    return isRunning ? "Promoting subagent" : "Subagent promoted";
  }
  if (toolName === "mcp__subagents__close_agent" || toolName === "mcp__subagents__close_subagent") {
    return isRunning ? "Closing agent" : "Agent closed";
  }
  // Peer agent ops. Without their own entries these fall through to the
  // creation verb below, which would claim a spawn that never happened.
  // `spawn_agent` is the opposite hazard: it IS a spawn, but of a peer, and the
  // fallback verb would call the new agent somebody's subagent.
  if (toolName === "mcp__subagents__spawn_agent") {
    return isRunning ? "Spawning agent" : "Agent spawned";
  }
  if (toolName === "mcp__subagents__send_agent_message") {
    return isRunning ? "Sending message to agent" : "Message sent to agent";
  }
  if (toolName === "mcp__subagents__list_agents") {
    return isRunning ? "Listing agents" : "Agents listed";
  }
  if (toolName === "mcp__subagents__read_agent_transcript") {
    return isRunning ? "Reading agent transcript" : "Agent transcript read";
  }
  if (toolName === "mcp__subagents__schedule_agent_wake") {
    return isRunning ? "Scheduling agent wake" : "Agent wake scheduled";
  }
  if (toolName === "mcp__subagents__get_agent_config_options") {
    return isRunning ? "Reading agent config options" : "Agent config options read";
  }
  if (toolName === "mcp__subagents__configure_agent") {
    return isRunning ? "Configuring agent" : "Agent configured";
  }
  // Workspace ops. Nothing here creates an agent, so the fallback verb below
  // would report a subagent launch — and, for `spawn_workspace`, a failure
  // would read as "Subagent launch failed" for a call that never touched one.
  // These branches name the failure themselves rather than falling through:
  // reporting a failed call as a settled success is worse than the wrong noun.
  if (toolName === "mcp__subagents__get_workspace_options") {
    if (executionState === "failed") {
      return "Workspace options unavailable";
    }
    return isRunning ? "Reading workspace options" : "Workspace options read";
  }
  if (toolName === "mcp__subagents__spawn_workspace") {
    if (executionState === "failed") {
      return "Workspace spawn failed";
    }
    return isRunning ? "Spawning workspace" : "Workspace spawned";
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
  // Only the product-MCP spawn receipt collapses into a creation group (the
  // create_subagent name is its pre-agent-ops alias). Native subagent calls
  // stay as durable transcript items throughout their lifecycle and must not
  // match here. Neither does `spawn_agent`: the creation group is the subagent
  // launch ledger, and a peer is nobody's subagent, so folding it in would put
  // an owned agent under a parent's fanout in the UI.
  const toolName = normalizeToolName(item.nativeToolName);
  return toolName === "mcp__subagents__spawn_subagent"
    || toolName === "mcp__subagents__create_subagent";
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
    ?? readStringField(rawOutput, "sessionId")
    ?? readStringField(rawInput, "childSessionId")
    ?? readStringField(rawInput, "child_session_id")
    ?? readStringField(rawInput, "sessionId");
  const title =
    readStringField(rawOutput, "label")
    ?? readStringField(rawInput, "label")
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
    actionLabel: actionLabel(action, item.status === "in_progress", item.nativeToolName),
    title,
    subagentId,
    sessionLinkId,
    childSessionId,
    statusLabel,
    detailLabel,
    wakeScheduled: action === "wake",
    // A close that is only REQUESTED leaves the agent running, so the receipt
    // still offers to open it.
    openSessionAllowed:
      (action !== "close" || readBooleanField(rawOutput, "closeRequested"))
      && normalizeStatus(rawStatus) !== "closed",
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
    case "mcp__subagents__read_subagent_events":
      return "read";
    case "mcp__subagents__read_subagent_latest_turns":
      return "read";
    case "mcp__subagents__search_subagent_transcript":
      return "search";
    case "mcp__subagents__promote_subagent":
      return "promote";
    case "mcp__subagents__close_agent":
    case "mcp__subagents__close_subagent":
      return "close";
    default:
      return null;
  }
}

function actionLabel(
  action: SubagentMcpReceiptAction,
  running: boolean,
  toolName: string | null | undefined,
): string {
  switch (action) {
    case "send":
      return running ? "Sending message to subagent" : "Sent message to subagent";
    case "wake":
      return running ? "Scheduling wake for subagent" : "Scheduled wake for subagent";
    case "status":
      return running ? "Checking subagent" : "Checked subagent";
    case "read":
      if (normalizeToolName(toolName) === "mcp__subagents__read_subagent_events") {
        return running ? "Reading subagent events" : "Read subagent events";
      }
      return running ? "Reading subagent turns" : "Read subagent turns";
    case "search":
      return running ? "Searching subagent" : "Searched subagent";
    case "promote":
      return running ? "Promoting subagent" : "Promoted subagent";
    case "close":
      return running ? "Closing agent" : "Closed agent";
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
      return readArrayCountLabel(output, "turns", "turn")
        ?? readArrayCountLabel(output, "events", "event");
    }
    case "search": {
      const matches = output.matches;
      return Array.isArray(matches)
        ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}`
        : null;
    }
    case "promote":
      return readBooleanField(output, "alreadyPromoted") ? "Already promoted" : "Now a peer";
    case "close":
      // A close of a working agent is a REQUEST: the agent finishes the step it
      // is on first, so the receipt must not read as though it already stopped.
      if (readBooleanField(output, "closeRequested")) {
        return "Finishing current step";
      }
      if (readBooleanField(output, "alreadyClosed")) {
        return "Already closed";
      }
      return readStringField(output, "closeReason");
  }
}

function readArrayCountLabel(
  output: Record<string, unknown>,
  key: string,
  singular: string,
): string | null {
  const value = output[key];
  if (!Array.isArray(value)) {
    return null;
  }
  return `${value.length} ${value.length === 1 ? singular : `${singular}s`}`;
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
