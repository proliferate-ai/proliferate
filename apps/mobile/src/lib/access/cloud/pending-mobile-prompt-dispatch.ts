import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import {
  getMobileCloudSandboxAnyHarnessClient,
} from "../anyharness/cloud-sandbox-runtime";
import { assertStillCurrent } from "./pending-mobile-prompt-polling";
import type { PendingMobilePromptDispatchResult } from "./pending-mobile-prompt-types";

export async function dispatchPendingMobilePrompt(args: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: MobilePendingPrompt;
  onSessionStarted?: (sessionId: string) => void;
  onPromptEnqueued?: (commandId: string | null) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<PendingMobilePromptDispatchResult> {
  const { connection, anyharness } = await getMobileCloudSandboxAnyHarnessClient({
    workspace: args.workspace,
    productToken: args.productToken,
    client: args.client,
  });
  assertStillCurrent(args.shouldContinue);

  const session = args.pendingPrompt.dispatchedSessionId
    ? await findExistingSession({
      anyharness,
      anyharnessWorkspaceId: connection.anyharnessWorkspaceId,
      cloudWorkspaceId: args.workspace.id,
      sessionId: args.pendingPrompt.dispatchedSessionId,
    })
    : null;
  const activeSession = session ?? await createSession({
    anyharness,
    anyharnessWorkspaceId: connection.anyharnessWorkspaceId,
    cloudWorkspaceId: args.workspace.id,
    pendingPrompt: args.pendingPrompt,
    onStatus: args.onStatus,
  });
  assertStillCurrent(args.shouldContinue);

  if (!args.pendingPrompt.dispatchedSessionId) {
    args.onSessionStarted?.(activeSession.sessionId);
  }
  const updates = args.pendingPrompt.sessionConfigUpdates ?? [];
  for (const update of updates) {
    assertStillCurrent(args.shouldContinue);
    args.onStatus("Applying session configuration.");
    await anyharness.sessions.setConfigOption(activeSession.sessionId, update);
  }
  assertStillCurrent(args.shouldContinue);
  args.onStatus("Sending queued prompt.");
  await anyharness.sessions.prompt(activeSession.sessionId, {
    blocks: [{ type: "text", text: args.pendingPrompt.text }],
    promptId: args.pendingPrompt.id,
  });
  args.onPromptEnqueued?.(null);
  return {
    sessionId: activeSession.sessionId,
    sendCommandId: null,
  };
}

async function createSession(input: {
  anyharness: Awaited<ReturnType<typeof getMobileCloudSandboxAnyHarnessClient>>["anyharness"];
  anyharnessWorkspaceId: string;
  cloudWorkspaceId: string;
  pendingPrompt: MobilePendingPrompt;
  onStatus: (status: string) => void;
}): Promise<CloudSessionProjection> {
  input.onStatus("Starting a session for this prompt.");
  const session = await input.anyharness.sessions.create({
    workspaceId: input.anyharnessWorkspaceId,
    agentKind: input.pendingPrompt.agentKind ?? "codex",
    ...(input.pendingPrompt.modelId ? { modelId: input.pendingPrompt.modelId } : {}),
    ...(input.pendingPrompt.modeId ? { modeId: input.pendingPrompt.modeId } : {}),
    subagentsEnabled: false,
    origin: { kind: "system", entrypoint: "cloud" },
  });
  return {
    cloudWorkspaceId: input.cloudWorkspaceId,
    targetId: input.cloudWorkspaceId,
    workspaceId: session.workspaceId ?? input.anyharnessWorkspaceId,
    sessionId: session.id,
    nativeSessionId: session.id,
    sourceAgentKind: session.agentKind ?? input.pendingPrompt.agentKind ?? null,
    title: session.title ?? null,
    status: session.status,
    phase: session.executionSummary?.phase ?? session.status ?? null,
    pendingInteractionCount: session.pendingPrompts?.length ?? 0,
    liveConfig: session.liveConfig ?? null,
    lastEventSeq: 0,
    lastEventAt: session.updatedAt ?? session.lastPromptAt ?? session.createdAt ?? null,
    startedAt: session.createdAt ?? null,
    endedAt: null,
  };
}

async function findExistingSession(input: {
  anyharness: Awaited<ReturnType<typeof getMobileCloudSandboxAnyHarnessClient>>["anyharness"];
  anyharnessWorkspaceId: string;
  cloudWorkspaceId: string;
  sessionId: string;
}): Promise<CloudSessionProjection | null> {
  const sessions = await input.anyharness.sessions.list(input.anyharnessWorkspaceId);
  const session = sessions.find((candidate) => candidate.id === input.sessionId);
  if (!session) {
    return null;
  }
  return {
    cloudWorkspaceId: input.cloudWorkspaceId,
    targetId: input.cloudWorkspaceId,
    workspaceId: session.workspaceId ?? input.anyharnessWorkspaceId,
    sessionId: session.id,
    nativeSessionId: session.id,
    sourceAgentKind: session.agentKind ?? null,
    title: session.title ?? null,
    status: session.status,
    phase: session.executionSummary?.phase ?? session.status ?? null,
    pendingInteractionCount: session.pendingPrompts?.length ?? 0,
    liveConfig: session.liveConfig ?? null,
    lastEventSeq: 0,
    lastEventAt: session.updatedAt ?? session.lastPromptAt ?? session.createdAt ?? null,
    startedAt: session.createdAt ?? null,
    endedAt: null,
  };
}
