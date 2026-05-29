import {
  getCommandStatus,
  getWorkspaceSnapshot,
  materializeTargetConfig,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
  type CloudSessionProjection,
  type CloudWorkspaceDetail,
  ProliferateClientError,
  type ProliferateCloudClient,
  type AgentAuthAgentKind,
} from "@proliferate/cloud-sdk";
import {
  cloudCommandReadiness,
} from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
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

export type PendingMobilePromptDispatchResult = {
  sessionId: string;
  sendCommandId: string;
};

const RETRYABLE_READINESS_ERROR_CODES = new Set([
  "cloud_command_target_config_required",
  "cloud_command_runtime_config_missing",
  "cloud_command_runtime_config_not_ready",
  "cloud_command_agent_auth_not_ready",
  "runtime_config_not_ready",
  "agent_auth_not_ready",
]);

const RETRYABLE_FAILURE_PATTERNS = [
  "timed out waiting for the cloud session to start",
  "timed out waiting for the cloud command to be accepted",
  "could not load existing sessions before starting a new one",
];

export class RetryablePendingPromptDispatchError extends Error {
  readonly retryable = true;
}

export function shouldRetryPendingMobilePromptFailure(
  prompt: Pick<MobilePendingPrompt, "failedAt" | "failureMessage">,
): boolean {
  if (!prompt.failedAt || !prompt.failureMessage) {
    return false;
  }
  return isRetryablePendingPromptFailureMessage(prompt.failureMessage);
}

export function rearmRetryablePendingMobilePrompt(
  prompt: MobilePendingPrompt,
): MobilePendingPrompt {
  if (!shouldRetryPendingMobilePromptFailure(prompt)) {
    return prompt;
  }
  return {
    ...prompt,
    failedAt: null,
    failureMessage: null,
  };
}

export async function dispatchPendingMobilePrompt(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  modelId: string | null;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  enqueueConfig: EnqueueCloudCommand<UpdateSessionConfigPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  setLatestCommandId: (commandId: string) => void;
  onSessionStarted?: (sessionId: string) => void;
  onPromptEnqueued?: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<PendingMobilePromptDispatchResult> {
  const session = args.pendingPrompt.dispatchedSessionId
    ? await resumeSessionForPrompt(args)
    : await startSessionForPrompt(args);
  assertStillCurrent(args.shouldContinue);
  if (!args.pendingPrompt.dispatchedSessionId) {
    args.onSessionStarted?.(session.sessionId);
  }
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
    source: "mobile",
    payload: {
      text: args.pendingPrompt.text,
      promptId: args.pendingPrompt.id,
    },
  });
  args.setLatestCommandId(command.commandId);
  assertCommandEnqueued(command);
  args.onPromptEnqueued?.(command.commandId);
  await waitForCommandAccepted(command, args.client, args.shouldContinue);
  return {
    sessionId: session.sessionId,
    sendCommandId: command.commandId,
  };
}

async function resumeSessionForPrompt(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  modelId: string | null;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudSessionProjection> {
  const dispatchedSessionId = args.pendingPrompt.dispatchedSessionId;
  if (!dispatchedSessionId) {
    throw new Error("Queued prompt is missing a dispatched session.");
  }
  const agentKind = args.pendingPrompt.agentKind ?? resolveAgentKind(args.workspace);
  const modelId = args.pendingPrompt.modelId ?? args.modelId;
  const workspace = await ensureMobileWorkspaceReadyForCloudCommands({
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
  args.onStatus("Resuming queued prompt.");
  const snapshot = await getWorkspaceSnapshot(workspace.id, args.client);
  assertStillCurrent(args.shouldContinue);
  const session = snapshot.sessions.find((candidate) =>
    candidate.sessionId === dispatchedSessionId
    && (!candidate.targetId || candidate.targetId === targetId)
  );
  if (!session) {
    throw new RetryablePendingPromptDispatchError(
      "Still waiting for the cloud session to resume. Retrying queued prompt handoff.",
    );
  }
  return {
    ...session,
    workspaceId: session.workspaceId || anyharnessWorkspaceId,
    targetId: session.targetId || targetId,
  };
}

async function startSessionForPrompt(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  modelId: string | null;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudSessionProjection> {
  const agentKind = args.pendingPrompt.agentKind ?? resolveAgentKind(args.workspace);
  const modelId = args.pendingPrompt.modelId ?? args.modelId;
  const modeId = args.pendingPrompt.modeId;
  const workspace = await ensureMobileWorkspaceReadyForCloudCommands({
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
  const existingSessionIds = await loadExistingSessionIds({
    client: args.client,
    workspaceId: workspace.id,
    targetId,
  });
  const command = await enqueueStartSessionWithRetryableReadiness({
    args,
    workspace,
    targetId,
    anyharnessWorkspaceId,
    agentKind,
    modelId,
    modeId,
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

async function applyPendingSessionConfigUpdates(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection;
  pendingPrompt: MobilePendingPrompt;
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
      source: "mobile",
      payload: update,
    });
    args.setLatestCommandId(command.commandId);
    assertCommandEnqueued(command);
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

export async function ensureMobileWorkspaceReadyForCloudCommands(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  agentKind?: string | null;
  modelId?: string | null;
  idempotencyKey: string;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudWorkspaceDetail> {
  let workspace = args.workspace;
  if (args.workspace.sandboxType === "managed_personal") {
    await ensurePersonalManagedAgentAuthReady({
      client: args.client,
      agentKind: args.agentKind ?? resolveAgentKind(args.workspace),
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
  const readiness = cloudCommandReadiness(workspace);
  if (!readiness.commandable) {
    throw new Error(readiness.message ?? "This workspace cannot accept cloud commands right now.");
  }
  assertStillCurrent(args.shouldContinue);
  await ensureManagedWorkspaceTargetConfigReady({
    ...args,
    workspace,
  });
  return workspace;
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
      throw new RetryablePendingPromptDispatchError(
        "Still waiting for cloud agent credentials to apply. Retrying queued prompt handoff.",
      );
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    latest = (await getWorkspaceSnapshot(args.workspaceId, args.client)).workspace;
  }
}

async function ensureManagedWorkspaceTargetConfigReady(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  idempotencyKey: string;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<void> {
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
      source: "mobile",
      idempotencyKey: args.idempotencyKey,
    },
    args.client,
  );
  const command = response.command as CloudCommandResponse;
  args.setLatestCommandId(command.commandId);
  args.onStatus("Applying managed target configuration.");
  assertCommandAccepted(
    await waitForCommandTerminal(
      command.commandId,
      args.client,
      args.shouldContinue,
      args.onStatus,
    ),
  );
}

function shouldMaterializeManagedTargetConfig(workspace: CloudWorkspaceDetail): boolean {
  if (workspace.sandboxType !== "managed_personal") {
    return false;
  }
  const runtimeAuth = workspace.runtime?.runtimeAuth;
  if (!runtimeAuth) {
    return true;
  }
  return runtimeAuth.targetCurrent !== true || runtimeAuth.configCurrent !== true;
}

function resolveAgentKind(workspace: CloudWorkspaceDetail): string {
  if (workspace.readyAgentKinds?.includes("codex")) {
    return "codex";
  }
  return workspace.readyAgentKinds?.[0] ?? workspace.allowedAgentKinds?.[0] ?? "codex";
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
      throw new RetryablePendingPromptDispatchError(
        "Still waiting for the cloud session to start. Retrying queued prompt handoff.",
      );
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
  }
}

async function waitForCommandAccepted(
  initialCommand: CloudCommandResponse,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  let latestCommand = initialCommand;
  let delayMs = 500;
  assertStillCurrent(shouldContinue);
  while (true) {
    latestCommand = await refreshCommandStatus(latestCommand, client, shouldContinue);
    assertCommandEnqueued(latestCommand);
    if (latestCommand.status === "accepted" || latestCommand.status === "accepted_but_queued") {
      return latestCommand;
    }
    assertStillCurrent(shouldContinue);
    if (Date.now() >= deadline) {
      throw new RetryablePendingPromptDispatchError(
        "Still waiting for the cloud command to be accepted. Retrying queued prompt handoff.",
      );
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
  }
}

async function waitForCommandTerminal(
  commandId: string,
  client: ProliferateCloudClient,
  shouldContinue: () => boolean,
  onStatus?: (status: string) => void,
): Promise<CloudCommandResponse> {
  const deadline = Date.now() + 240_000;
  let latest = await getCommandStatus(commandId, client);
  let delayMs = 500;
  let lastStatusMessage: string | null = null;
  assertStillCurrent(shouldContinue);
  while (!isTerminalStatus(latest.status)) {
    assertStillCurrent(shouldContinue);
    if (Date.now() >= deadline) {
      throw new RetryablePendingPromptDispatchError(
        "Still waiting for the cloud command to finish. Retrying queued prompt handoff.",
      );
    }
    const nextStatusMessage = commandPendingMessage(latest.status);
    if (nextStatusMessage && nextStatusMessage !== lastStatusMessage) {
      onStatus?.(nextStatusMessage);
      lastStatusMessage = nextStatusMessage;
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    assertStillCurrent(shouldContinue);
    latest = await getCommandStatus(commandId, client);
  }
  assertStillCurrent(shouldContinue);
  return latest;
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
    // Command-status reads can briefly race the command creation response.
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
  throw new RetryablePendingPromptDispatchError(
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
  return !expectedAgentKind
    || !session.sourceAgentKind
    || session.sourceAgentKind === expectedAgentKind;
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

function assertStillCurrent(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Queued prompt handoff was cancelled.");
  }
}

async function enqueueStartSessionWithRetryableReadiness(input: {
  args: {
    pendingPrompt: MobilePendingPrompt;
    enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  };
  workspace: CloudWorkspaceDetail;
  targetId: string;
  anyharnessWorkspaceId: string;
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
}): Promise<CloudCommandResponse> {
  try {
    return await input.args.enqueueStartSession({
      idempotencyKey: `${input.args.pendingPrompt.id}:start-session`,
      targetId: input.targetId,
      cloudWorkspaceId: input.workspace.id,
      kind: "start_session",
      source: "mobile",
      payload: {
        workspaceId: input.anyharnessWorkspaceId,
        agentKind: input.agentKind,
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.modeId ? { modeId: input.modeId } : {}),
        subagentsEnabled: false,
        origin: { kind: "system", entrypoint: "cloud" },
      },
    });
  } catch (error) {
    throw retryableReadinessError(error) ?? error;
  }
}

function assertCommandEnqueued(command: CloudCommandResponse): void {
  if (
    command.status === "rejected" ||
    command.status === "expired" ||
    command.status === "superseded" ||
    command.status === "failed_delivery"
  ) {
    if (command.errorCode && RETRYABLE_READINESS_ERROR_CODES.has(command.errorCode)) {
      throw new RetryablePendingPromptDispatchError(
        command.errorMessage || "Workspace runtime is still preparing for session start.",
      );
    }
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
  }
}

function assertCommandAccepted(command: CloudCommandResponse): void {
  if (command.status !== "accepted" && command.status !== "accepted_but_queued") {
    throw new Error(command.errorMessage || `Cloud command ${command.status}.`);
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

function retryableReadinessError(error: unknown): RetryablePendingPromptDispatchError | null {
  if (
    error instanceof Error
    && isRetryablePendingPromptFailureMessage(error.message)
  ) {
    return new RetryablePendingPromptDispatchError(error.message);
  }
  if (
    error instanceof ProliferateClientError
    && error.status === 409
    && error.code
    && RETRYABLE_READINESS_ERROR_CODES.has(error.code)
  ) {
    return new RetryablePendingPromptDispatchError(
      error.message || "Workspace runtime is still preparing for session start.",
    );
  }
  return null;
}

function isRetryablePendingPromptFailureMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return RETRYABLE_FAILURE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function normalizeAgentAuthAgentKind(agentKind: string): AgentAuthAgentKind | null {
  return agentKind === "claude"
    || agentKind === "codex"
    || agentKind === "opencode"
    || agentKind === "gemini"
    ? agentKind
    : null;
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
  const object = objectFromUnknown(value);
  if (!object) {
    return null;
  }
  const nested = object[key];
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
    setTimeout(resolve, ms);
  });
}

function nextPollDelay(currentMs: number): number {
  return Math.min(Math.round(currentMs * 1.5), 2_500);
}
