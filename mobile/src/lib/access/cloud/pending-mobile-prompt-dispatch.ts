import {
  getCommandStatus,
  getWorkspaceSnapshot,
  type CloudCommandEnvelope,
  type CloudCommandResponse,
  type CloudSessionProjection,
  type CloudWorkspaceDetail,
  ProliferateClientError,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";

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

type EnqueueCloudCommand<TPayload> = (
  command: CloudCommandEnvelope<TPayload>,
) => Promise<CloudCommandResponse>;

const RETRYABLE_READINESS_ERROR_CODES = new Set([
  "cloud_command_target_config_required",
  "cloud_command_runtime_config_missing",
  "cloud_command_runtime_config_not_ready",
  "cloud_command_agent_auth_not_ready",
]);

export class RetryablePendingPromptDispatchError extends Error {
  readonly retryable = true;
}

export async function dispatchPendingMobilePrompt(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  modelId: string | null;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  enqueuePrompt: EnqueueCloudCommand<SendPromptPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<string> {
  const session = await startSessionForPrompt(args);
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
  await waitForCommandAccepted(command, args.client, args.shouldContinue);
  return session.sessionId;
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
  const targetId = args.workspace.targetId;
  const anyharnessWorkspaceId = args.workspace.anyharnessWorkspaceId;
  if (!targetId || !anyharnessWorkspaceId) {
    throw new Error("Workspace is ready but missing runtime command routing.");
  }
  const agentKind = resolveAgentKind(args.workspace);
  const modelId = agentKind === "codex" ? args.modelId : null;
  const modeId = args.pendingPrompt.modeId;
  const existingSessionIds = await loadExistingSessionIds({
    client: args.client,
    workspaceId: args.workspace.id,
    targetId,
  });
  const command = await enqueueStartSessionWithRetryableReadiness({
    args,
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
    workspaceId: args.workspace.id,
    targetId,
    fallbackWorkspaceId: anyharnessWorkspaceId,
    existingSessionIds,
    shouldContinue: args.shouldContinue,
  });
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
      throw new Error("Timed out waiting for the cloud command to be accepted.");
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
      .sort(compareSessionFreshness)[0] ?? null;
  } catch {
    return null;
  }
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
    workspace: CloudWorkspaceDetail;
    pendingPrompt: MobilePendingPrompt;
    enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  };
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
      workspaceId: input.anyharnessWorkspaceId,
      cloudWorkspaceId: input.args.workspace.id,
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

function retryableReadinessError(error: unknown): RetryablePendingPromptDispatchError | null {
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

function parseStartedSessionId(command: CloudCommandResponse): string | null {
  const candidates = [
    command.sessionId,
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
  return null;
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
    setTimeout(resolve, ms);
  });
}

function nextPollDelay(currentMs: number): number {
  return Math.min(Math.round(currentMs * 1.5), 2_500);
}
