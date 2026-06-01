import {
  getWorkspaceSnapshot,
  type CloudCommandResponse,
  type CloudSessionProjection,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { PendingHomePrompt } from "./pending-home-prompt-store";
import type { EnqueueCloudCommand, StartSessionPayload } from "./cloud-command-payloads";
import {
  assertCommandEnqueued,
} from "./cloud-command-status";
import {
  assertStillCurrent,
  nextPollDelay,
  refreshCommandStatus,
  sleep,
} from "./cloud-command-polling";
import { parseStartedSessionId } from "./cloud-command-result";
import {
  assertWorkspaceCanAcceptCloudCommands,
  prepareManagedWorkspaceForCloudCommands,
} from "./managed-workspace-command-readiness";

export async function startSessionForPrompt(args: {
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

function resolveAgentKind(workspace: CloudWorkspaceDetail): string {
  if (workspace.readyAgentKinds?.includes("codex")) {
    return "codex";
  }
  return workspace.readyAgentKinds?.[0] ?? workspace.allowedAgentKinds?.[0] ?? "codex";
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
