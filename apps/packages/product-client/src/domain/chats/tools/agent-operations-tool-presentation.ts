import type { ToolCallItem, ToolResultTextContentPart, Workspace } from "@anyharness/sdk";

const TOOL_PREFIX = "mcp__workspace__";

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
  source: "workspace" | "legacy_subagents";
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

export function isAgentOperationsReadAction(item: Pick<ToolCallItem, "nativeToolName">): boolean {
  return classifyAgentOperationsTool(item.nativeToolName)?.presentation === "read";
}

export function isAgentOperationsReceiptAction(item: Pick<ToolCallItem, "nativeToolName">): boolean {
  return classifyAgentOperationsTool(item.nativeToolName)?.presentation === "receipt";
}

export function isWorkspaceSubagentCreationAction(
  item: Pick<ToolCallItem, "nativeToolName" | "rawInput">,
): boolean {
  const classification = classifyAgentOperationsTool(item.nativeToolName);
  if (classification?.action !== "create_agent") {
    return false;
  }
  const input = coerceRecord(item.rawInput) ?? {};
  return readString(input, "kind")?.toLowerCase() === "subagent";
}

export function deriveAgentOperationsReceiptPresentation(
  item: ToolCallItem,
): AgentOperationsReceiptPresentation | null {
  const classification = classifyAgentOperationsTool(item.nativeToolName);
  if (!classification || classification.presentation !== "receipt") {
    return null;
  }

  const action = classification.action;
  const input = coerceRecord(item.rawInput) ?? {};
  const output = readStructuredOutput(item);
  const isRunning = item.status === "in_progress";
  const isFailed = item.status === "failed";
  const targetAgentId = readString(input, "agentId");

  if (action === "create_workspace") {
    const workspaceEnvelope = parseCreateWorkspaceEnvelope(output);
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
      detailLabel: workspace ? formatWorkspaceDetail(workspace) : null,
      isRunning,
      isFailed,
    };
  }

  const agentRecord = extractAgentRecord(action, output);
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

function targetAgentFromDurableId(sessionId: string): AgentOperationsAgentTarget {
  return {
    runtimeId: null,
    sessionId,
    workspaceId: null,
    title: null,
    role: null,
    presentationStatus: null,
    executionStatus: null,
    closed: false,
  };
}

export function readAgentOperationsStructuredOutput(
  item: ToolCallItem,
): Record<string, unknown> | null {
  return readStructuredOutput(item);
}

function extractAgentRecord(
  action: Exclude<AgentOperationsReceiptAction, "create_workspace">,
  output: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!output) {
    return null;
  }
  if (action === "configure_agent") {
    const agent = coerceRecord(output.agent);
    const applyState = readString(output, "applyState");
    return agent
      && looksLikeDirectAgentView(agent)
      && (applyState === "applied" || applyState === "queued")
      ? agent
      : null;
  }
  if (action === "send_message") {
    const target = coerceRecord(output.target);
    if (
      !target
      || !readString(target, "runtimeId")
      || !readString(target, "sessionId")
      || !Number.isInteger(output.queueSeq)
      || output.status !== "durably_queued"
    ) {
      return null;
    }
    return {
      identity: target,
      title: null,
      role: null,
      status: null,
      workspace: null,
    };
  }

  // Lifecycle and create operations return a direct AgentView. Deliberately do
  // not accept the HTTP `{ agent, relationship }` envelope here: transcript
  // receipts are MCP wire artifacts, and silently accepting the other surface
  // would hide a contract regression.
  return looksLikeDirectAgentView(output) ? output : null;
}

function parseCreateWorkspaceEnvelope(
  output: Record<string, unknown> | null,
): {
  workspace: Record<string, unknown>;
  envelope: Record<string, unknown>;
} | null {
  if (!output) {
    return null;
  }
  const workspace = coerceRecord(output.workspace);
  const creationMode = readString(output, "creationMode");
  if (!workspace || (creationMode !== "worktree" && creationMode !== "local")) {
    return null;
  }
  return { workspace, envelope: output };
}

function looksLikeDirectAgentView(value: Record<string, unknown>): boolean {
  return coerceRecord(value.identity) !== null
    && ("status" in value || "role" in value || "workspace" in value);
}

function parseAgentTarget(value: Record<string, unknown>): AgentOperationsAgentTarget {
  const identity = coerceRecord(value.identity) ?? {};
  const workspace = coerceRecord(value.workspace) ?? {};
  const status = coerceRecord(value.status) ?? {};
  const sessionId = readString(identity, "sessionId");
  const presentationStatus = readString(status, "presentation");
  const executionStatus = readString(status, "execution");
  return {
    runtimeId: readString(identity, "runtimeId"),
    sessionId,
    workspaceId: readString(workspace, "workspaceId"),
    title: readString(value, "title"),
    role: readString(value, "role"),
    presentationStatus,
    executionStatus,
    closed: presentationStatus === "closed" || executionStatus === "closed",
  };
}

function parseWorkspaceTarget(
  workspace: Record<string, unknown>,
  envelope: Record<string, unknown>,
  input: Record<string, unknown>,
): AgentOperationsWorkspaceTarget {
  const identity = coerceRecord(workspace.identity) ?? workspace;
  const repository = coerceRecord(workspace.repository) ?? {};
  const source = coerceRecord(workspace.source) ?? {};
  const knownWorkspace = projectKnownWorkspace(workspace, identity);
  return {
    runtimeId: readString(identity, "runtimeId"),
    workspaceId: readString(identity, "workspaceId"),
    displayName: knownWorkspace
      ? receiptWorkspaceDisplayName(knownWorkspace)
      : readString(workspace, "displayName")
        ?? readString(workspace, "name")
        ?? readString(input, "displayName")
        ?? readString(input, "name")
        ?? workspacePathBasename(readString(workspace, "path"))
        ?? "Workspace",
    repositoryLabel:
      readString(workspace, "repositoryName")
      ?? readString(repository, "name")
      ?? readString(source, "repositoryName"),
    branchLabel:
      readString(workspace, "currentBranch")
      ?? readString(workspace, "originalBranch")
      ?? readString(input, "branch")
      ?? readString(input, "baseBranch"),
    creationMode: readString(envelope, "creationMode"),
    knownWorkspace,
  };
}

function projectKnownWorkspace(
  workspace: Record<string, unknown>,
  identity: Record<string, unknown>,
): Workspace | null {
  const id = readString(identity, "workspaceId");
  const repoRootId = readString(workspace, "repositoryId");
  const path = readString(workspace, "path");
  const createdAt = readString(workspace, "createdAt");
  const updatedAt = readString(workspace, "updatedAt");
  if (!id || !repoRootId || !path || !createdAt || !updatedAt) {
    return null;
  }
  const kind = readString(workspace, "kind") === "worktree" ? "worktree" : "local";
  const surface = readString(workspace, "surface") === "cowork" ? "cowork" : "standard";
  const lifecycleState = readString(workspace, "lifecycleState") === "retired"
    ? "retired"
    : "active";
  return {
    id,
    repoRootId,
    path,
    kind,
    surface,
    lifecycleState,
    availability: "available",
    displayName: readString(workspace, "displayName"),
    originalBranch: readString(workspace, "originalBranch"),
    currentBranch: readString(workspace, "currentBranch"),
    origin: (workspace.origin ?? null) as Workspace["origin"],
    creatorContext: (workspace.creatorContext ?? null) as Workspace["creatorContext"],
    executionSummary: null,
    cleanupState: "none",
    cleanupOperation: null,
    cleanupAttemptedAt: null,
    cleanupFailedAt: null,
    cleanupErrorMessage: null,
    createdAt,
    updatedAt,
  };
}

function workspacePathBasename(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function receiptWorkspaceDisplayName(workspace: Workspace): string {
  const displayName = workspace.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  if (workspace.kind === "worktree") {
    const branch = workspace.currentBranch?.trim() || workspace.originalBranch?.trim();
    if (branch) {
      return humanizeReceiptBranchName(branch);
    }
  }
  return workspacePathBasename(workspace.path) ?? "Workspace";
}

function humanizeReceiptBranchName(branchName: string): string {
  const suffix = branchName.split("/").filter(Boolean).pop() ?? branchName;
  const spaced = suffix.replace(/[-_]+/gu, " ").trim();
  return spaced.length > 0
    ? `${spaced[0]!.toUpperCase()}${spaced.slice(1)}`
    : suffix;
}

function formatWorkspaceDetail(workspace: AgentOperationsWorkspaceTarget): string | null {
  const creationProvenance = [
    workspace.creationMode
      ? workspace.creationMode.replace(/[_-]+/gu, " ").toLowerCase()
      : null,
    workspace.branchLabel ? `from ${workspace.branchLabel}` : null,
  ].filter((value): value is string => Boolean(value)).join(" ");
  const parts = [
    workspace.repositoryLabel,
    creationProvenance || null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function detailLabel(
  action: Exclude<AgentOperationsReceiptAction, "create_workspace">,
  output: Record<string, unknown> | null,
): string | null {
  if (!output) {
    return null;
  }
  if (action === "configure_agent") {
    const applyState = readString(output, "applyState");
    return applyState ? formatWords(applyState) : null;
  }
  if (action === "send_message") {
    const status = readString(output, "status");
    return status ? formatWords(status) : null;
  }
  return null;
}

function actionLabel(
  action: AgentOperationsReceiptAction,
  running: boolean,
  failed: boolean,
): string {
  switch (action) {
    case "create_workspace":
      return running ? "Creating workspace" : failed ? "Failed to create workspace" : "Created workspace";
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

function readStructuredOutput(item: ToolCallItem): Record<string, unknown> | null {
  const rawObject = coerceRecord(item.rawOutput);
  if (rawObject) {
    return rawObject;
  }
  if (typeof item.rawOutput === "string") {
    const parsedRawOutput = parseJsonRecord(item.rawOutput);
    if (parsedRawOutput) {
      return parsedRawOutput;
    }
  }
  const text = item.contentParts
    .filter((part): part is ToolResultTextContentPart => part.type === "tool_result_text")
    .map((part) => part.text.trim())
    .find((part) => part.length > 0);
  return text ? parseJsonRecord(text) : null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return coerceRecord(JSON.parse(value));
  } catch {
    return null;
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

function coerceRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  if (typeof field !== "string") {
    return null;
  }
  const trimmed = field.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatWords(value: string): string {
  const normalized = value.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized.length > 0
    ? normalized.replace(/^\w/u, (character) => character.toUpperCase())
    : value;
}
