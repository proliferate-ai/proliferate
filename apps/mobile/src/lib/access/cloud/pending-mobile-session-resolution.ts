import {
  getCommandStatus,
  getWorkspaceSnapshot,
  type CloudCommandResponse,
  type CloudSessionProjection,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import {
  assertCommandEnqueued,
  parseStartedSessionId,
} from "./pending-mobile-command-status";
import {
  RetryablePendingPromptDispatchError,
  retryableReadinessError,
} from "./pending-mobile-prompt-errors";
import {
  assertStillCurrent,
  nextPollDelay,
  sleep,
} from "./pending-mobile-prompt-polling";
import type {
  EnqueueCloudCommand,
  StartSessionPayload,
} from "./pending-mobile-prompt-types";
import {
  ensureMobileWorkspaceReadyForCloudCommands,
  resolvePendingMobilePromptAgentKind,
} from "./pending-mobile-workspace-readiness";

export async function resumePendingMobilePromptSession(args: {
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
  const agentKind = args.pendingPrompt.agentKind ?? resolvePendingMobilePromptAgentKind(args.workspace);
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

export async function startPendingMobilePromptSession(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  modelId: string | null;
  enqueueStartSession: EnqueueCloudCommand<StartSessionPayload>;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudSessionProjection> {
  const agentKind = args.pendingPrompt.agentKind ?? resolvePendingMobilePromptAgentKind(args.workspace);
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
