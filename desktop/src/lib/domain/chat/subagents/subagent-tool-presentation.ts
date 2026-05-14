import type { ToolCallItem } from "@anyharness/sdk";
import type { SubagentExecutionState } from "@/lib/domain/chat/subagents/subagent-launch";

type ToolNameOwner = Pick<ToolCallItem, "nativeToolName">;

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
  switch (normalizeToolName(item.nativeToolName)) {
    case "agent":
    case "mcp__subagents__create_subagent":
    case "mcp__subagents__send_subagent_message":
    case "mcp__subagents__schedule_subagent_wake":
      return true;
    default:
      return false;
  }
}

function normalizeToolName(toolName: string | null | undefined): string {
  return toolName?.trim().toLowerCase() ?? "";
}
