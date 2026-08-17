import type { ToolCallItem } from "@anyharness/sdk";
import {
  deriveAgentOperationsReceiptPresentation,
  readAgentOperationsStructuredOutput,
  type AgentOperationsReceiptPresentation,
} from "#product/domain/chats/tools/agent-operations-tool-presentation";
import { readAgentOperationsInput } from "#product/domain/chats/tools/agent-operations-tool-wire";

/**
 * Accepts a Workspace MCP mutation only when its completed AgentView is both
 * structurally complete and correlated to the caller, workspace, and input.
 * Stream and history ingestion share this authority boundary.
 */
export function deriveAuthoritativeAgentOperation(
  item: ToolCallItem,
  callerSessionId: string,
  callerWorkspaceId: string | null,
): AgentOperationsReceiptPresentation | null {
  const presentation = deriveAgentOperationsReceiptPresentation(item);
  const input = readAgentOperationsInput(item);
  const output = readAgentOperationsStructuredOutput(item);
  if (
    item.status !== "completed"
    ||
    !presentation
    || !input
    || !output
    || !isCompleteAgentOperationsAuthorityView(output)
    || !isCorrelatedAgentOperationsAuthority(
      presentation.action,
      input,
      output,
      callerSessionId,
      callerWorkspaceId,
    )
  ) {
    return null;
  }
  return presentation;
}

function isCorrelatedAgentOperationsAuthority(
  action: AgentOperationsReceiptPresentation["action"],
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  callerSessionId: string,
  callerWorkspaceId: string | null,
): boolean {
  if (action !== "create_agent" && action !== "promote_subagent") {
    return false;
  }
  const identity = isRecord(output.identity) ? output.identity : null;
  const workspace = isRecord(output.workspace) ? output.workspace : null;
  if (!identity || !workspace) {
    return false;
  }
  const sessionId = authorityString(identity, "sessionId");
  const runtimeId = authorityString(identity, "runtimeId");
  const workspaceId = authorityString(workspace, "workspaceId");
  const workspaceRuntimeId = authorityString(workspace, "runtimeId");
  if (!sessionId || !runtimeId || !workspaceId || runtimeId !== workspaceRuntimeId) {
    return false;
  }
  if (action === "promote_subagent") {
    return callerWorkspaceId !== null
      && workspaceId === callerWorkspaceId
      && output.role === "ordinary"
      && (output.parent === null || output.parent === undefined)
      && authorityString(input, "agentId") === sessionId
      && sessionId !== callerSessionId;
  }
  const inputKind = authorityString(input, "kind");
  const inputWorkspaceId = authorityString(input, "workspaceId");
  if (inputKind === "ordinary") {
    return output.role === "ordinary"
      && (output.parent === null || output.parent === undefined)
      && inputWorkspaceId === workspaceId
      && sessionId !== callerSessionId;
  }
  const parent = isRecord(output.parent) ? output.parent : null;
  return callerWorkspaceId !== null
    && workspaceId === callerWorkspaceId
    && output.role === "subagent"
    && inputKind === "subagent"
    && inputWorkspaceId === workspaceId
    && parent !== null
    && authorityString(parent, "runtimeId") === runtimeId
    && authorityString(parent, "sessionId") === callerSessionId
    && sessionId !== callerSessionId;
}

function isCompleteAgentOperationsAuthorityView(
  value: Record<string, unknown>,
): boolean {
  const configuration = isRecord(value.configuration) ? value.configuration : null;
  return isCompleteAuthorityIdentity(value.identity)
    && isCompleteAuthorityIdentity(value.workspace, "workspaceId")
    && (value.role === "ordinary" || value.role === "subagent")
    && isRecognizedAuthorityStatus(value.status)
    && configuration !== null
    && isNonEmptyString(configuration.agentKind)
    && optionalString(configuration.modelId)
    && optionalString(configuration.modeId)
    && Array.isArray(value.capabilities)
    && value.capabilities.every(isRecognizedAgentOperationsCapability)
    && isNonEmptyString(value.createdAt)
    && isNonEmptyString(value.updatedAt)
    && optionalString(value.title)
    && (
      value.parent === null
      || value.parent === undefined
      || isCompleteAuthorityIdentity(value.parent)
    );
}

function isCompleteAuthorityIdentity(
  value: unknown,
  idField: "sessionId" | "workspaceId" = "sessionId",
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return isNonEmptyString(value.runtimeId) && isNonEmptyString(value[idField]);
}

function isRecognizedAuthorityStatus(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.presentation === "running"
    || value.presentation === "available"
    || value.presentation === "closed"
  ) && (
    value.execution === "starting"
    || value.execution === "running"
    || value.execution === "awaiting_interaction"
    || value.execution === "idle"
    || value.execution === "errored"
    || value.execution === "closed"
  ) && typeof value.hasLiveActor === "boolean";
}

function isRecognizedAgentOperationsCapability(value: unknown): boolean {
  return typeof value === "string" && AGENT_OPERATIONS_CAPABILITIES.has(value);
}

const AGENT_OPERATIONS_CAPABILITIES = new Set([
  "whoami",
  "list_workspaces",
  "list_workspace_options",
  "create_workspace",
  "pin_workspace",
  "unpin_workspace",
  "list_agents",
  "get_agent",
  "list_subagents",
  "list_agent_launch_options",
  "list_agent_config_options",
  "get_task_output",
  "create_agent",
  "configure_agent",
  "resume_agent",
  "send_message",
  "interrupt_agent",
  "close_subagent",
  "open_subagent",
  "promote_subagent",
]);

function authorityString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return isNonEmptyString(candidate) ? candidate : null;
}

function optionalString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
