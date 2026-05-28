import {
  getCommandStatus,
  getWorkspaceSnapshot,
  materializeTargetConfig,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
  type CloudSessionProjection,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
  type AgentAuthAgentKind,
} from "@proliferate/cloud-sdk";
import {
  cloudCommandReadiness,
} from "@proliferate/product-model/workspaces/cloud-work-inventory";

import type { PendingHomePrompt } from "./pending-home-prompt-store";
import { ensurePersonalAgentAuthLaunchReady } from "./agent-auth-launch-readiness";

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
  const command = await enqueuePromptWithRetry({
    workspace: args.workspace,
    session,
    pendingPrompt: args.pendingPrompt,
    enqueuePrompt: args.enqueuePrompt,
    shouldContinue: args.shouldContinue,
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

export async function resumePendingHomePromptInSession(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection;
  pendingPrompt: PendingHomePrompt;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<PendingHomePromptDispatchResult> {
  await applyPendingSessionConfigUpdates({
    client: args.client,
    workspace: args.workspace,
    session: args.session,
    pendingPrompt: args.pendingPrompt,
    enqueueConfig: args.enqueueConfig,
    setLatestCommandId: args.setLatestCommandId,
    onStatus: args.onStatus,
    shouldContinue: args.shouldContinue,
  });
  assertStillCurrent(args.shouldContinue);
  args.onStatus("Sending queued prompt.");
  const command = await enqueuePromptWithRetry({
    workspace: args.workspace,
    session: args.session,
    pendingPrompt: args.pendingPrompt,
    enqueuePrompt: args.enqueuePrompt,
    shouldContinue: args.shouldContinue,
  });
  args.setLatestCommandId(command.commandId);
  if (isRejectedCommandStatus(command.status)) {
    assertCommandAccepted(command);
  }
  args.onStatus("Queued prompt; waiting for transcript.");
  return {
    sessionId: args.session.sessionId,
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
  const agentKind = args.pendingPrompt.agentKind ?? resolveAgentKind(args.workspace);
  const modelId = args.pendingPrompt.modelId ?? args.modelId;
  const modeId = args.pendingPrompt.modeId;
  const workspace = await prepareManagedWorkspaceForCloudCommands({
    client: args.client,
    workspace: args.workspace,
    agentKind,
    modelId,
    idempotencyKey: `${args.pendingPrompt.id}:target-config`,
    setLatestCommandId: args.setLatestCommandId,
    onStatus: args.onStatus,
    shouldContinue: args.shouldContinue,
  });
  const targetId = workspace.targetId;
  const anyharnessWorkspaceId = workspace.anyharnessWorkspaceId;
  if (!targetId || !anyharnessWorkspaceId) {
    throw new Error("Workspace is ready but missing runtime command routing.");
  }
  assertWorkspaceCanAcceptCloudCommands(workspace);
  assertStillCurrent(args.shouldContinue);
  const existingSessionIds = await loadExistingSessionIds({
    client: args.client,
    workspaceId: workspace.id,
    targetId,
  });
  const command = await args.enqueueStartSession({
    idempotencyKey: `${args.pendingPrompt.id}:start-session`,
    targetId,
    cloudWorkspaceId: workspace.id,
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
  assertCommandEnqueued(command);
  args.onStatus("Waiting for the session to start.");
  return waitForStartedSession({
    client: args.client,
    command,
    workspaceId: workspace.id,
    targetId,
    fallbackWorkspaceId: anyharnessWorkspaceId,
    existingSessionIds,
    expectedAgentKind: agentKind,
    shouldContinue: args.shouldContinue,
  });
}

export async function prepareManagedWorkspaceForCloudCommands(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  agentKind: string;
  modelId?: string | null;
  idempotencyKey: string;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudWorkspaceDetail> {
  let workspace = args.workspace;
  if (workspace.sandboxType === "managed_personal") {
    await ensurePersonalManagedAgentAuthReady({
      client: args.client,
      agentKind: args.agentKind,
      modelId: args.modelId,
      onStatus: args.onStatus,
    });
    assertStillCurrent(args.shouldContinue);
    workspace = await waitForManagedAgentAuthCurrent({
      client: args.client,
      workspaceId: workspace.id,
      onStatus: args.onStatus,
      shouldContinue: args.shouldContinue,
    });
  }
  assertWorkspaceCanAcceptCloudCommands(workspace);
  await ensureManagedWorkspaceTargetConfigReady({
    client: args.client,
    workspace,
    idempotencyKey: args.idempotencyKey,
    setLatestCommandId: args.setLatestCommandId,
    onStatus: args.onStatus,
    shouldContinue: args.shouldContinue,
  });
  return workspace;
}

async function waitForManagedAgentAuthCurrent(args: {
  client: ProliferateCloudClient;
  workspaceId: string;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudWorkspaceDetail> {
  const deadline = Date.now() + 120_000;
  let delayMs = 500;
  let latest = (await getWorkspaceSnapshot(args.workspaceId, args.client)).workspace;
  while (true) {
    assertStillCurrent(args.shouldContinue);
    const runtimeAuth = latest.runtime?.runtimeAuth;
    if (runtimeAuth?.targetCurrent === true) {
      return latest;
    }
    if (runtimeAuth?.status === "apply_failed" || runtimeAuth?.status === "missing_credentials") {
      throw new Error(
        runtimeAuth.lastError
          ?? "Cloud agent credentials are not ready for this workspace.",
      );
    }
    args.onStatus("Applying cloud agent credentials.");
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for cloud agent credentials to apply.");
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    latest = (await getWorkspaceSnapshot(args.workspaceId, args.client)).workspace;
  }
}

async function ensurePersonalManagedAgentAuthReady(args: {
  client: ProliferateCloudClient;
  agentKind: string;
  modelId?: string | null;
  onStatus: (status: string) => void;
}): Promise<void> {
  await ensurePersonalAgentAuthLaunchReady({
    client: args.client,
    agentKind: normalizeAgentAuthAgentKind(args.agentKind),
    modelId: args.modelId,
    onStatus: args.onStatus,
  });
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
  const updates = filterSessionConfigUpdatesForSession(
    args.pendingPrompt.sessionConfigUpdates ?? [],
    args.session,
  );
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
    const applyState = configApplyState(completed);
    if (applyState && applyState !== "applied") {
      throw new Error("Session configuration was queued but not applied.");
    }
  }
}

export async function ensureManagedWorkspaceTargetConfigReady(
  args: {
    client: ProliferateCloudClient;
    workspace: CloudWorkspaceDetail;
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
      ownerScope: "personal",
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

export function assertWorkspaceCanAcceptCloudCommands(
  workspace: CloudWorkspaceDetail,
): void {
  const readiness = cloudCommandReadiness(workspace);
  if (readiness.commandable) {
    return;
  }
  throw new Error(readiness.message ?? "This workspace cannot accept cloud commands right now.");
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

function normalizeAgentAuthAgentKind(agentKind: string): AgentAuthAgentKind | null {
  return agentKind === "claude"
    || agentKind === "codex"
    || agentKind === "opencode"
    || agentKind === "gemini"
    ? agentKind
    : null;
}

async function enqueuePromptWithRetry(args: {
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection;
  pendingPrompt: PendingHomePrompt;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  shouldContinue: () => boolean;
}): Promise<CloudCommandResponse> {
  const envelope: CloudCommandEnvelope<SendPromptPayload> = {
    idempotencyKey: `${args.pendingPrompt.id}:send`,
    targetId: args.session.targetId,
    workspaceId: args.session.workspaceId,
    cloudWorkspaceId: args.workspace.id,
    sessionId: args.session.sessionId,
    kind: "send_prompt",
    source: "web",
    payload: {
      text: args.pendingPrompt.text,
      promptId: args.pendingPrompt.id,
    },
  };
  return enqueuePromptCommandWithRetry({
    envelope,
    enqueuePrompt: args.enqueuePrompt,
    shouldContinue: args.shouldContinue,
  });
}

export async function enqueuePromptCommandWithRetry(args: {
  envelope: CloudCommandEnvelope<SendPromptPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  shouldContinue: () => boolean;
}): Promise<CloudCommandResponse> {
  let lastError: unknown = null;
  for (const delayMs of [0, 750, 1500]) {
    assertStillCurrent(args.shouldContinue);
    if (delayMs > 0) {
      await sleep(delayMs);
      assertStillCurrent(args.shouldContinue);
    }
    try {
      return await args.enqueuePrompt(args.envelope);
    } catch (error) {
      lastError = error;
      if (!isRecoverableCloudDispatchError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Prompt could not be sent.");
}

export function isRecoverableCloudDispatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(failed to fetch|network|load failed|connection|aborted|timeout|timed out)\b/i
    .test(message);
}

async function waitForCommandTerminal(
  commandId: string,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
  onStatus?: (status: string) => void,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  assertStillCurrent(shouldContinue);
  let latest = await getCommandStatusWithRecoverableRetry({
    commandId,
    client,
    shouldContinue,
    deadline,
  });
  let delayMs = 500;
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
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    assertStillCurrent(shouldContinue);
    latest = await getCommandStatusWithRecoverableRetry({
      commandId,
      client,
      shouldContinue,
      deadline,
    });
  }
  assertStillCurrent(shouldContinue);
  return latest;
}

async function getCommandStatusWithRecoverableRetry(args: {
  commandId: string;
  client: ProliferateCloudClient;
  shouldContinue: () => boolean;
  deadline: number;
}): Promise<CloudCommandResponse> {
  let delayMs = 500;
  let lastError: unknown = null;
  while (Date.now() < args.deadline) {
    assertStillCurrent(args.shouldContinue);
    try {
      return await getCommandStatus(args.commandId, args.client);
    } catch (error) {
      lastError = error;
      if (!isRecoverableCloudDispatchError(error)) {
        throw error;
      }
      await sleep(delayMs);
      delayMs = nextPollDelay(delayMs);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for the cloud command to finish.");
}

async function waitForStartedSession(args: {
  client: ProliferateCloudClient;
  command: CloudCommandResponse;
  workspaceId: string;
  targetId: string;
  fallbackWorkspaceId: string;
  existingSessionIds: Set<string>;
  expectedAgentKind: string | null;
  shouldContinue: () => boolean;
}): Promise<CloudSessionProjection> {
  const deadline = Date.now() + 240_000;
  let latestCommand = args.command;
  let expectedSessionId = parseStartedSessionId(latestCommand);
  let delayMs = 500;
  assertStillCurrent(args.shouldContinue);
  while (true) {
    latestCommand = await refreshCommandStatus(
      latestCommand,
      args.client,
      args.shouldContinue,
    );
    assertCommandEnqueued(latestCommand);
    expectedSessionId = expectedSessionId ?? parseStartedSessionId(latestCommand);

    const session = await findStartedSession({
      client: args.client,
      workspaceId: args.workspaceId,
      targetId: args.targetId,
      expectedSessionId,
      existingSessionIds: args.existingSessionIds,
      expectedAgentKind: args.expectedAgentKind,
      startedAfter: latestCommand.createdAt,
      shouldContinue: args.shouldContinue,
    });
    if (session) {
      return {
        ...session,
        workspaceId: session.workspaceId || args.fallbackWorkspaceId,
        targetId: session.targetId || args.targetId,
      };
    }
    assertStillCurrent(args.shouldContinue);
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the cloud session to start.");
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
  }
}

async function refreshCommandStatus(
  fallback: CloudCommandResponse,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
): Promise<CloudCommandResponse> {
  assertStillCurrent(shouldContinue);
  try {
    return await getCommandStatus(fallback.commandId, client);
  } catch {
    return fallback;
  }
}

async function loadExistingSessionIds(args: {
  client: ProliferateCloudClient;
  workspaceId: string;
  targetId: string;
}): Promise<Set<string>> {
  let lastError: unknown = null;
  let delayMs = 500;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const snapshot = await getWorkspaceSnapshot(args.workspaceId, args.client);
      return new Set(
        snapshot.sessions
          .filter((session) => session.targetId === args.targetId)
          .map((session) => session.sessionId),
      );
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await sleep(delayMs);
        delayMs = nextPollDelay(delayMs);
      }
    }
  }
  throw new Error(
    lastError instanceof Error
      ? `Could not load existing sessions before starting a new one: ${lastError.message}`
      : "Could not load existing sessions before starting a new one.",
  );
}

async function findStartedSession(args: {
  client: ProliferateCloudClient;
  workspaceId: string;
  targetId: string;
  expectedSessionId: string | null;
  existingSessionIds: Set<string>;
  expectedAgentKind: string | null;
  startedAfter: string | null | undefined;
  shouldContinue: () => boolean;
}): Promise<CloudSessionProjection | null> {
  assertStillCurrent(args.shouldContinue);
  try {
    const snapshot = await getWorkspaceSnapshot(args.workspaceId, args.client);
    const sessionsForTarget = snapshot.sessions.filter((candidate) =>
      candidate.targetId === args.targetId
    );
    if (args.expectedSessionId) {
      return sessionsForTarget.find((candidate) =>
        candidate.sessionId === args.expectedSessionId
      ) ?? null;
    }
    return sessionsForTarget
      .filter((candidate) => !args.existingSessionIds.has(candidate.sessionId))
      .filter((candidate) => sessionMatchesExpectedAgent(candidate, args.expectedAgentKind))
      .filter((candidate) => sessionStartedAfter(candidate, args.startedAfter))
      .sort(compareSessionFreshness)[0] ?? null;
  } catch {
    return null;
  }
}

function sessionMatchesExpectedAgent(
  session: CloudSessionProjection,
  expectedAgentKind: string | null,
): boolean {
  return !expectedAgentKind || session.sourceAgentKind === expectedAgentKind;
}

function sessionStartedAfter(
  session: CloudSessionProjection,
  startedAfter: string | null | undefined,
): boolean {
  if (!startedAfter) {
    return true;
  }
  const baseline = Date.parse(startedAfter);
  if (!Number.isFinite(baseline)) {
    return true;
  }
  const sessionTime = Date.parse(session.startedAt ?? session.lastEventAt ?? "");
  return Number.isFinite(sessionTime) && sessionTime >= baseline;
}

function compareSessionFreshness(
  left: CloudSessionProjection,
  right: CloudSessionProjection,
): number {
  const rightTime = Date.parse(right.startedAt ?? right.lastEventAt ?? "") || 0;
  const leftTime = Date.parse(left.startedAt ?? left.lastEventAt ?? "") || 0;
  return rightTime - leftTime || (right.lastEventSeq ?? 0) - (left.lastEventSeq ?? 0);
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

function assertCommandEnqueued(command: CloudCommandResponse): void {
  if (isRejectedCommandStatus(command.status)) {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

function assertCommandAccepted(command: CloudCommandResponse): void {
  if (command.status !== "accepted" && command.status !== "accepted_but_queued") {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

function parseStartedSessionId(command: CloudCommandResponse): string | null {
  const result = commandResultObject(command);
  const body = commandResultBodyObject(command);
  const candidates = [
    command.sessionId,
    result?.sessionId,
    result?.session_id,
    nestedString(body, "sessionId"),
    nestedString(body, "session_id"),
    nestedString(body, "id"),
    nestedString(nestedObject(body, "session"), "id"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function configApplyState(command: CloudCommandResponse): string | null {
  const result = commandResultObject(command);
  const body = commandResultBodyObject(command);
  return nestedString(body, "applyState")
    ?? nestedString(result, "applyState");
}

function filterSessionConfigUpdatesForSession(
  updates: UpdateSessionConfigPayload[],
  session: CloudSessionProjection,
): UpdateSessionConfigPayload[] {
  const supportedConfigIds = collectSupportedSessionConfigIds(session);
  if (supportedConfigIds.size === 0) {
    return [];
  }
  return updates.filter((update) => supportedConfigIds.has(update.configId));
}

function collectSupportedSessionConfigIds(session: CloudSessionProjection): Set<string> {
  const supported = new Set<string>();
  const liveConfig = objectFromUnknown((session as unknown as Record<string, unknown>).liveConfig);
  const rawOptions = Array.isArray(liveConfig?.rawConfigOptions)
    ? liveConfig.rawConfigOptions
    : [];
  for (const option of rawOptions) {
    const id = nestedString(option, "id");
    if (id) {
      supported.add(id);
    }
  }
  const controls = objectFromUnknown(liveConfig?.normalizedControls);
  if (controls) {
    for (const control of Object.values(controls)) {
      const rawConfigId = nestedString(control, "rawConfigId");
      if (rawConfigId) {
        supported.add(rawConfigId);
      }
    }
  }
  return supported;
}

function commandResultObject(command: CloudCommandResponse): Record<string, unknown> | null {
  return objectFromUnknown(command.result);
}

function commandResultBodyObject(command: CloudCommandResponse): Record<string, unknown> | null {
  const result = commandResultObject(command);
  return objectFromUnknown(result?.body);
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
  const object = objectFromUnknown(value);
  if (!object) return null;
  const nested = object[key];
  return typeof nested === "string" ? nested : null;
}

function objectFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return objectFromUnknown(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function nextPollDelay(currentMs: number): number {
  return Math.min(Math.round(currentMs * 1.5), 2_500);
}
