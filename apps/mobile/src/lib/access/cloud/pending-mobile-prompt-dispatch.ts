import type {
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { MobilePendingPrompt } from "../../../navigation/navigation-model";
import {
  assertCommandEnqueued,
  waitForCommandAccepted,
} from "./pending-mobile-command-status";
import { assertStillCurrent } from "./pending-mobile-prompt-polling";
import type {
  EnqueueCloudCommand,
  PendingMobilePromptDispatchResult,
  SendPromptPayload,
  StartSessionPayload,
  UpdateSessionConfigPayload,
} from "./pending-mobile-prompt-types";
import { applyPendingSessionConfigUpdates } from "./pending-mobile-session-config";
import {
  resumePendingMobilePromptSession,
  startPendingMobilePromptSession,
} from "./pending-mobile-session-resolution";

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
    ? await resumePendingMobilePromptSession(args)
    : await startPendingMobilePromptSession(args);
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
