import type { ToolCallItem, Workspace } from "@anyharness/sdk";
import {
  detailLabel,
  extractAgentRecord,
  formatWorkspaceDetail,
  parseAgentTarget,
  parseCreateWorkspaceEnvelope,
  parseWorkspacePinEnvelope,
  parseWorkspaceTarget,
  readString,
  targetAgentFromDurableId,
} from "./agent-operations-tool-output";
import {
  AGENT_OPERATIONS_TOOL_PREFIX,
  readAgentOperationsInput,
  readAgentOperationsOutput,
  resolveAgentOperationsToolName,
} from "./agent-operations-tool-wire";

const TOOL_PREFIX = AGENT_OPERATIONS_TOOL_PREFIX;

export const AGENT_OPERATIONS_READ_ACTIONS = [
  "whoami",
  "list_workspaces",
  "list_workspace_options",
  "list_agents",
  "get_agent",
  "list_subagents",
  "list_agent_launch_options",
  "list_agent_config_options",
  "get_task_output",
] as const;

export const AGENT_OPERATIONS_RECEIPT_ACTIONS = [
  "create_workspace",
  "pin_workspace",
  "unpin_workspace",
  "create_agent",
  "configure_agent",
  "resume_agent",
  "send_message",
  "interrupt_agent",
  "close_subagent",
  "open_subagent",
  "promote_subagent",
] as const;

export type AgentOperationsReadAction = typeof AGENT_OPERATIONS_READ_ACTIONS[number];
export type AgentOperationsReceiptAction = typeof AGENT_OPERATIONS_RECEIPT_ACTIONS[number];
export type AgentOperationsAction = AgentOperationsReadAction | AgentOperationsReceiptAction;

export type AgentOperationsToolClassification =
  | { action: AgentOperationsReadAction; presentation: "read" }
  | { action: AgentOperationsReceiptAction; presentation: "receipt" };

export interface AgentOperationsAgentTarget {
  runtimeId: string | null;
  sessionId: string | null;
  workspaceId: string | null;
  parentSessionId: string | null;
  title: string | null;
  role: string | null;
  presentationStatus: string | null;
  executionStatus: string | null;
  closed: boolean;
}

export interface AgentOperationsWorkspaceTarget {
  runtimeId: string | null;
  workspaceId: string | null;
  displayName: string;
  repositoryLabel: string | null;
  branchLabel: string | null;
  creationMode: string | null;
  knownWorkspace: Workspace | null;
}

export interface AgentOperationsReceiptPresentation {
  source: "workspace";
  action: AgentOperationsReceiptAction;
  actionLabel: string;
  targetAgentId: string | null;
  agent: AgentOperationsAgentTarget | null;
  workspace: AgentOperationsWorkspaceTarget | null;
  message: string | null;
  detailLabel: string | null;
  isRunning: boolean;
  isFailed: boolean;
}

export function classifyAgentOperationsTool(
  toolName: string | null | undefined,
): AgentOperationsToolClassification | null {
  const normalized = normalizeToolName(toolName);
  if (!normalized.startsWith(TOOL_PREFIX)) {
    return null;
  }
  const action = normalized.slice(TOOL_PREFIX.length);
  if (isReadAction(action)) {
    return { action, presentation: "read" };
  }
  if (isReceiptAction(action)) {
    return { action, presentation: "receipt" };
  }
  return null;
}

export function resolveAgentOperationsTool(
  item: Pick<ToolCallItem, "nativeToolName" | "rawInput">,
): AgentOperationsToolClassification | null {
  return classifyAgentOperationsTool(resolveAgentOperationsToolName(item));
}

export function isAgentOperationsReadAction(
  item: Pick<ToolCallItem, "nativeToolName" | "rawInput">,
): boolean {
  return resolveAgentOperationsTool(item)?.presentation === "read";
}

export function isAgentOperationsReceiptAction(
  item: Pick<ToolCallItem, "nativeToolName" | "rawInput">,
): boolean {
  return resolveAgentOperationsTool(item)?.presentation === "receipt";
}

export function deriveAgentOperationsReadTarget(
  item: ToolCallItem,
): AgentOperationsAgentTarget | null {
  const classification = resolveAgentOperationsTool(item);
  if (
    classification?.presentation !== "read"
    || !["get_agent", "list_agent_config_options", "get_task_output"].includes(
      classification.action,
    )
  ) {
    return null;
  }
  const input = readAgentOperationsInput(item) ?? {};
  const targetAgentId = readString(input, "agentId");
  if (!targetAgentId) {
    return null;
  }
  if (classification.action === "get_agent") {
    const output = readAgentOperationsOutput(item);
    if (output) {
      const parsed = parseAgentTarget(output);
      if (parsed.sessionId === targetAgentId) {
        return parsed;
      }
    }
  }
  return targetAgentFromDurableId(targetAgentId);
}

export function isWorkspaceSubagentCreationAction(
  item: Pick<ToolCallItem, "nativeToolName" | "rawInput">,
): boolean {
  const classification = resolveAgentOperationsTool(item);
  if (classification?.action !== "create_agent") {
    return false;
  }
  const input = readAgentOperationsInput(item) ?? {};
  return readString(input, "kind")?.toLowerCase() === "subagent";
}

export function deriveAgentOperationsReceiptPresentation(
  item: ToolCallItem,
): AgentOperationsReceiptPresentation | null {
  const classification = resolveAgentOperationsTool(item);
  if (!classification || classification.presentation !== "receipt") {
    return null;
  }

  const action = classification.action;
  const input = readAgentOperationsInput(item) ?? {};
  const output = readAgentOperationsOutput(item);
  const isRunning = item.status === "in_progress";
  const isFailed = item.status === "failed";
  const targetAgentId = readString(input, "agentId");

  if (
    action === "create_workspace"
    || action === "pin_workspace"
    || action === "unpin_workspace"
  ) {
    const workspaceEnvelope = action === "create_workspace"
      ? parseCreateWorkspaceEnvelope(output)
      : parseWorkspacePinEnvelope(output, action === "pin_workspace");
    const workspace = workspaceEnvelope
      ? parseWorkspaceTarget(workspaceEnvelope.workspace, workspaceEnvelope.envelope, input)
      : null;
    return {
      source: "workspace",
      action,
      actionLabel: actionLabel(action, isRunning, isFailed),
      targetAgentId: null,
      agent: null,
      workspace,
      message: null,
      detailLabel: action === "create_workspace" && workspace
        ? formatWorkspaceDetail(workspace)
        : null,
      isRunning,
      isFailed,
    };
  }

  const agentRecord = action === "create_agent" && item.status !== "completed"
    ? null
    : extractAgentRecord(action, output);
  const agent = agentRecord
    ? parseAgentTarget(agentRecord)
    : targetAgentId && action !== "create_agent"
      ? targetAgentFromDurableId(targetAgentId)
      : null;
  const message = action === "send_message"
    ? readString(input, "message") ?? readString(input, "text")
    : null;
  return {
    source: "workspace",
    action,
    actionLabel: actionLabel(action, isRunning, isFailed),
    targetAgentId,
    agent,
    workspace: null,
    message,
    detailLabel: detailLabel(action, agentRecord ? output : null),
    isRunning,
    isFailed,
  };
}

export function readAgentOperationsStructuredOutput(
  item: ToolCallItem,
): Record<string, unknown> | null {
  return readAgentOperationsOutput(item);
}

function actionLabel(
  action: AgentOperationsReceiptAction,
  running: boolean,
  failed: boolean,
): string {
  switch (action) {
    case "create_workspace":
      return running ? "Creating workspace" : failed ? "Failed to create workspace" : "Created workspace";
    case "pin_workspace":
      return running ? "Pinning workspace" : failed ? "Failed to pin workspace" : "Requested pin";
    case "unpin_workspace":
      return running ? "Unpinning workspace" : failed ? "Failed to unpin workspace" : "Requested unpin";
    case "create_agent":
      return running ? "Creating agent" : failed ? "Failed to create agent" : "Created agent";
    case "configure_agent":
      return running ? "Configuring agent" : failed ? "Failed to configure agent" : "Configured agent";
    case "resume_agent":
      return running ? "Resuming agent" : failed ? "Failed to resume agent" : "Resumed agent";
    case "send_message":
      return running ? "Sending message to" : failed ? "Message to agent failed" : "Sent message to";
    case "interrupt_agent":
      return running ? "Interrupting agent" : failed ? "Failed to interrupt agent" : "Interrupted agent";
    case "close_subagent":
      return running ? "Closing subagent" : failed ? "Failed to close subagent" : "Closed subagent";
    case "open_subagent":
      return running ? "Opening subagent" : failed ? "Failed to open subagent" : "Opened subagent";
    case "promote_subagent":
      return running ? "Promoting subagent" : failed ? "Failed to promote subagent" : "Promoted subagent";
  }
}

function isReadAction(value: string): value is AgentOperationsReadAction {
  return (AGENT_OPERATIONS_READ_ACTIONS as readonly string[]).includes(value);
}

function isReceiptAction(value: string): value is AgentOperationsReceiptAction {
  return (AGENT_OPERATIONS_RECEIPT_ACTIONS as readonly string[]).includes(value);
}

function normalizeToolName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
