import {
  getCommandStatus,
  ensureFreeManagedCredits,
  materializeTargetConfig,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
  type CloudSessionProjection,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { PendingHomePrompt } from "./pending-home-prompt-store";

export type SendPromptPayload = {
  text: string;
  promptId?: string;
};

export type StartSessionPayload = {
  workspaceId: string;
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
  subagentsEnabled: boolean;
  origin: {
    kind: "system";
    entrypoint: "cloud";
  };
};

export type UpdateSessionConfigPayload = {
  configId: string;
  value: string;
};

type EnqueueCloudCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

export type PendingHomePromptDispatchResult = {
  sessionId: string;
  sendCommandId: string;
};

export async function dispatchPendingHomePrompt(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: PendingHomePrompt;
  modelId: string | null;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<PendingHomePromptDispatchResult> {
  const session = await startSessionForPrompt(args);
  assertStillCurrent(args.shouldContinue);
  await applyPendingSessionConfigUpdates({
    client: args.client,
    workspace: args.workspace,
    session,
    pendingPrompt: args.pendingPrompt,
    enqueueConfig: args.enqueueConfig,
    setLatestCommandId: args.setLatestCommandId,
    onStatus: args.onStatus,
    shouldContinue: args.shouldContinue,
  });
  assertStillCurrent(args.shouldContinue);
  args.onStatus("Sending queued prompt.");
  const command = await args.enqueuePrompt({
    idempotencyKey: `${args.pendingPrompt.id}:send`,
    targetId: session.targetId,
    workspaceId: session.workspaceId,
    cloudWorkspaceId: args.workspace.id,
    sessionId: session.sessionId,
    kind: "send_prompt",
    source: "web",
    payload: {
      text: args.pendingPrompt.text,
      promptId: args.pendingPrompt.id,
    },
  });
  args.setLatestCommandId(command.commandId);
  if (isRejectedCommandStatus(command.status)) {
    assertCommandAccepted(command);
  }
  args.onStatus("Queued prompt; waiting for transcript.");
  return {
    sessionId: session.sessionId,
    sendCommandId: command.commandId,
  };
}

async function startSessionForPrompt(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: PendingHomePrompt;
  modelId: string | null;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudSessionProjection> {
  const targetId = args.workspace.targetId;
  const anyharnessWorkspaceId = args.workspace.anyharnessWorkspaceId;
  if (!targetId || !anyharnessWorkspaceId) {
    throw new Error("Workspace is ready but missing runtime command routing.");
  }
  if (args.pendingPrompt.ownerScope !== "organization") {
    await ensurePersonalManagedAgentAuthReady({
      client: args.client,
      onStatus: args.onStatus,
    });
  }
  assertStillCurrent(args.shouldContinue);
  await ensureManagedWorkspaceTargetConfigReady({
    client: args.client,
    workspace: args.workspace,
    pendingPrompt: args.pendingPrompt,
    idempotencyKey: `${args.pendingPrompt.id}:target-config`,
    setLatestCommandId: args.setLatestCommandId,
    onStatus: args.onStatus,
    shouldContinue: args.shouldContinue,
  });
  assertStillCurrent(args.shouldContinue);
  const agentKind = args.pendingPrompt.agentKind ?? resolveAgentKind(args.workspace);
  const modelId = args.pendingPrompt.modelId ?? args.modelId;
  const modeId = args.pendingPrompt.modeId;
  const command = await args.enqueueStartSession({
    idempotencyKey: `${args.pendingPrompt.id}:start-session`,
    targetId,
    workspaceId: anyharnessWorkspaceId,
    cloudWorkspaceId: args.workspace.id,
    kind: "start_session",
    source: "web",
    payload: {
      workspaceId: anyharnessWorkspaceId,
      agentKind,
      ...(modelId ? { modelId } : {}),
      ...(modeId ? { modeId } : {}),
      subagentsEnabled: false,
      origin: { kind: "system", entrypoint: "cloud" },
    },
  });
  args.setLatestCommandId(command.commandId);
  args.onStatus("Waiting for the session to start.");
  const completed = await waitForCommandTerminal(
    command.commandId,
    args.client,
    args.shouldContinue,
    args.onStatus,
  );
  assertCommandAccepted(completed);
  assertStillCurrent(args.shouldContinue);
  const sessionId = parseStartedSessionId(completed);
  return {
    targetId,
    workspaceId: anyharnessWorkspaceId,
    sessionId,
    title: null,
    status: "running",
    lastEventSeq: 0,
    lastEventAt: null,
    itemCount: 0,
    pendingInteractionCount: 0,
    updatedAt: null,
    createdAt: null,
  } as CloudSessionProjection;
}

async function ensurePersonalManagedAgentAuthReady(args: {
  client: ProliferateCloudClient;
  onStatus: (status: string) => void;
}): Promise<void> {
  args.onStatus("Checking cloud agent credits.");
  const result = await ensureFreeManagedCredits({}, args.client);
  if (result.status === "not_entitled" || result.status === "gateway_disabled") {
    return;
  }
  if (!result.launchEnabled) {
    throw new Error(
      result.lastErrorMessage
        ?? "Cloud agent credits are not ready yet. Please retry in a moment.",
    );
  }
}

async function applyPendingSessionConfigUpdates(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection;
  pendingPrompt: PendingHomePrompt;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<void> {
  const updates = args.pendingPrompt.sessionConfigUpdates ?? [];
  if (updates.length === 0) {
    return;
  }
  args.onStatus("Applying session configuration.");
  for (const update of updates) {
    assertStillCurrent(args.shouldContinue);
    const command = await args.enqueueConfig({
      idempotencyKey: `${args.pendingPrompt.id}:config:${update.configId}`,
      targetId: args.session.targetId,
      workspaceId: args.session.workspaceId,
      cloudWorkspaceId: args.workspace.id,
      sessionId: args.session.sessionId,
      kind: "update_session_config",
      source: "web",
      payload: update,
    });
    args.setLatestCommandId(command.commandId);
    const completed = await waitForCommandTerminal(
      command.commandId,
      args.client,
      args.shouldContinue,
      args.onStatus,
    );
    assertCommandAccepted(completed);
    if (configApplyState(completed) !== "applied") {
      throw new Error("Session configuration was queued but not applied.");
    }
  }
}

export async function ensureManagedWorkspaceTargetConfigReady(
  args: {
    client: ProliferateCloudClient;
    workspace: CloudWorkspaceDetail;
    pendingPrompt?: PendingHomePrompt;
    idempotencyKey: string;
    setLatestCommandId: (commandId: string) => void;
    onStatus: (status: string) => void;
    shouldContinue: () => boolean;
  },
): Promise<void> {
  if (!shouldMaterializeManagedTargetConfig(args.workspace)) {
    return;
  }
  const targetId = args.workspace.targetId;
  if (!targetId) {
    throw new Error("Workspace is ready but missing runtime command routing.");
  }
  const repo = args.workspace.repo;
  args.onStatus("Preparing managed target configuration.");
  const response = await materializeTargetConfig(
    targetId,
    {
      ownerScope: args.pendingPrompt?.ownerScope ?? "personal",
      organizationId: args.pendingPrompt?.ownerScope === "organization"
        ? args.pendingPrompt.organizationId ?? null
        : null,
      gitProvider: "github",
      gitOwner: repo.owner,
      gitRepoName: repo.name,
      includeGitCredentials: true,
      source: "web",
      idempotencyKey: args.idempotencyKey,
    },
    args.client,
  );
  args.setLatestCommandId(response.command.commandId);
  args.onStatus("Applying managed target configuration.");
  assertCommandAccepted(
    await waitForCommandTerminal(
      response.command.commandId,
      args.client,
      args.shouldContinue,
      args.onStatus,
    ),
  );
}

function shouldMaterializeManagedTargetConfig(workspace: CloudWorkspaceDetail): boolean {
  if (workspace.sandboxType === "managed_shared") {
    return false;
  }
  if (workspace.sandboxType !== "managed_personal") {
    return false;
  }
  const runtimeAuth = workspace.runtime?.runtimeAuth;
  if (!runtimeAuth) {
    return false;
  }
  return runtimeAuth.targetCurrent !== true || runtimeAuth.configCurrent !== true;
}

function resolveAgentKind(workspace: CloudWorkspaceDetail): string {
  if (workspace.readyAgentKinds?.includes("codex")) {
    return "codex";
  }
  return workspace.readyAgentKinds?.[0] ?? workspace.allowedAgentKinds?.[0] ?? "codex";
}

async function waitForCommandTerminal(
  commandId: string,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
  onStatus?: (status: string) => void,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  assertStillCurrent(shouldContinue);
  let latest = await getCommandStatus(commandId, client);
  let lastStatusMessage: string | null = null;
  while (!isTerminalStatus(latest.status)) {
    assertStillCurrent(shouldContinue);
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the cloud command to finish.");
    }
    const nextStatusMessage = commandPendingMessage(latest.status);
    if (nextStatusMessage && nextStatusMessage !== lastStatusMessage) {
      onStatus?.(nextStatusMessage);
      lastStatusMessage = nextStatusMessage;
    }
    await sleep(500);
    assertStillCurrent(shouldContinue);
    latest = await getCommandStatus(commandId, client);
  }
  assertStillCurrent(shouldContinue);
  return latest;
}

function commandPendingMessage(status: CloudCommandResponse["status"]): string | null {
  switch (status) {
    case "queued":
      return "Command queued; waiting for the cloud runtime.";
    case "leased":
      return "Cloud runtime is picking up the command.";
    case "delivered":
      return "Command delivered; waiting for runtime acknowledgement.";
    default:
      return null;
  }
}

function assertStillCurrent(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Queued prompt handoff was cancelled.");
  }
}

function isTerminalStatus(status: CloudCommandResponse["status"]): boolean {
  return status === "accepted"
    || status === "accepted_but_queued"
    || status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function isRejectedCommandStatus(status: CloudCommandResponse["status"]): boolean {
  return status === "rejected"
    || status === "expired"
    || status === "superseded"
    || status === "failed_delivery";
}

function assertCommandAccepted(command: CloudCommandResponse): void {
  if (command.status !== "accepted" && command.status !== "accepted_but_queued") {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

function parseStartedSessionId(command: CloudCommandResponse): string {
  const candidates = [
    command.result?.sessionId,
    command.result?.session_id,
    nestedString(command.result?.body, "sessionId"),
    nestedString(command.result?.body, "session_id"),
    nestedString(command.result?.body, "id"),
    nestedString(nestedObject(command.result?.body, "session"), "id"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  throw new Error("Cloud session command completed without a session id.");
}

function configApplyState(command: CloudCommandResponse): string | null {
  return nestedString(command.result?.body, "applyState")
    ?? nestedString(command.result, "applyState");
}

function nestedObject(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : null;
}

function nestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === "string" ? nested : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
