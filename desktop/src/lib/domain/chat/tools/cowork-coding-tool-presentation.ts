import type {
  ToolCallItem,
  ToolResultTextContentPart,
} from "@anyharness/sdk";

export type CoworkCodingAction =
  | "launch_options"
  | "create_workspace"
  | "list_workspaces"
  | "session_launch_options"
  | "create_session"
  | "send_message"
  | "schedule_wake"
  | "status"
  | "read_events"
  | "read_latest_turns"
  | "search_transcript"
  | "close_agent";

export interface CoworkCodingToolPresentation {
  action: CoworkCodingAction;
  label: string;
  running: boolean;
  displayName: string | null;
  meta: string | null;
  prompt: string | null;
  promptStatus: string | null;
  sourceWorkspaceId: string | null;
  workspaceId: string | null;
  coworkWorkspaceId: string | null;
  codingSessionId: string | null;
  coworkAgentId: string | null;
  sessionLinkId: string | null;
  parentSessionId: string | null;
  eventCount: number | null;
  truncated: boolean | null;
  wakeScheduled: boolean | null;
}

const ACTION_LABELS: Record<CoworkCodingAction, string> = {
  launch_options: "Read coding workspace options",
  create_workspace: "Created coding workspace",
  list_workspaces: "Listed coding workspaces",
  session_launch_options: "Read coding session options",
  create_session: "Created coding session",
  send_message: "Sent coding message",
  schedule_wake: "Scheduled coding wake",
  status: "Checked coding status",
  read_events: "Read coding events",
  read_latest_turns: "Read cowork agent turns",
  search_transcript: "Searched cowork agent transcript",
  close_agent: "Closed cowork agent",
};

export function deriveCoworkCodingToolPresentation(
  item: ToolCallItem,
): CoworkCodingToolPresentation | null {
  if (item.semanticKind !== "cowork_coding") {
    return null;
  }

  const action = resolveAction(item.nativeToolName);
  if (!action) {
    return null;
  }

  const input = isRecord(item.rawInput) ? item.rawInput : {};
  const output = isRecord(item.rawOutput) ? item.rawOutput : parseToolResultJsonObject(item);
  const initialConfig = readRecord(input, "initialConfig");
  const appliedInitialConfig = readRecord(output, "appliedInitialConfig");
  const wake = readRecord(output, "wake");
  const label = readString(input, "label")
    ?? readString(output, "label")
    ?? readString(input, "workspaceName")
    ?? readString(output, "workspaceName")
    ?? readString(input, "branchName")
    ?? readString(output, "branchName");
  const promptStatus = readString(output, "promptStatus") ?? readString(output, "status");
  const agentKind = readString(appliedInitialConfig, "harnessId")
    ?? readString(input, "harnessId")
    ?? readString(input, "agentKind");
  const modelId = readString(appliedInitialConfig, "modelId")
    ?? readString(initialConfig, "modelId")
    ?? readString(initialConfig, "model")
    ?? readString(input, "modelId");
  const eventCount = Array.isArray(output?.events) ? output.events.length : null;
  const truncated = typeof output?.truncated === "boolean" ? output.truncated : null;

  return {
    action,
    label: ACTION_LABELS[action],
    running: item.status === "in_progress",
    displayName: label,
    meta: [
      agentKind ? formatAgentKind(agentKind) : null,
      modelId,
    ].filter((value): value is string => !!value).join(" · ") || null,
    prompt: readString(input, "prompt"),
    promptStatus,
    sourceWorkspaceId: readString(input, "sourceWorkspaceId"),
    workspaceId:
      readString(output, "workspaceId")
      ?? readString(input, "workspaceId"),
    coworkWorkspaceId:
      readString(output, "coworkWorkspaceId")
      ?? readString(input, "coworkWorkspaceId"),
    codingSessionId:
      readString(output, "codingSessionId")
      ?? readString(input, "codingSessionId"),
    coworkAgentId:
      readString(output, "coworkAgentId")
      ?? readString(input, "coworkAgentId"),
    sessionLinkId: readString(output, "sessionLinkId") ?? readString(input, "sessionLinkId"),
    parentSessionId: readString(output, "parentSessionId") ?? readString(input, "parentSessionId"),
    eventCount,
    truncated,
    wakeScheduled: readBoolean(output, "wakeScheduled") ?? readBoolean(wake, "scheduled"),
  };
}

function resolveAction(nativeToolName: string | null): CoworkCodingAction | null {
  switch ((nativeToolName ?? "").trim().toLowerCase()) {
    case "mcp__cowork__get_cowork_workspace_launch_options":
    case "mcp__cowork__get_coding_workspace_launch_options":
      return "launch_options";
    case "mcp__cowork__create_cowork_workspace":
    case "mcp__cowork__create_coding_workspace":
      return "create_workspace";
    case "mcp__cowork__list_cowork_workspaces":
    case "mcp__cowork__list_coding_workspaces":
      return "list_workspaces";
    case "mcp__cowork__get_cowork_agent_launch_options":
    case "mcp__cowork__get_coding_session_launch_options":
      return "session_launch_options";
    case "mcp__cowork__create_cowork_agent":
    case "mcp__cowork__create_coding_session":
      return "create_session";
    case "mcp__cowork__send_cowork_agent_message":
    case "mcp__cowork__send_coding_message":
      return "send_message";
    case "mcp__cowork__schedule_cowork_agent_wake":
    case "mcp__cowork__schedule_coding_wake":
      return "schedule_wake";
    case "mcp__cowork__get_cowork_agent_status":
    case "mcp__cowork__get_coding_status":
      return "status";
    case "mcp__cowork__read_cowork_agent_events":
    case "mcp__cowork__read_coding_events":
      return "read_events";
    case "mcp__cowork__read_cowork_agent_latest_turns":
      return "read_latest_turns";
    case "mcp__cowork__search_cowork_agent_transcript":
      return "search_transcript";
    case "mcp__cowork__close_cowork_agent":
      return "close_agent";
    default:
      return null;
  }
}

function parseToolResultJsonObject(item: ToolCallItem): Record<string, unknown> | null {
  const text = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  if (typeof field !== "string") {
    return null;
  }
  const trimmed = field.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown, key: string): boolean | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "boolean" ? field : null;
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return isRecord(field) ? field : null;
}

function formatAgentKind(agentKind: string): string {
  const normalized = agentKind.trim().toLowerCase();
  return normalized === "claude"
    ? "Claude"
    : normalized === "codex"
      ? "Codex"
      : normalized === "gemini"
        ? "Gemini"
        : normalized === "opencode"
          ? "OpenCode"
          : normalized.replace(/[_-]+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
