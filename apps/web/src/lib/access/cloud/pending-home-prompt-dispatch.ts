import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";

import type { PendingHomePrompt } from "./pending-home-prompt-store";
import type {
  EnqueueCloudCommand,
  PendingHomePromptDispatchResult,
  SendPromptPayload,
  StartSessionPayload,
  UpdateSessionConfigPayload,
} from "./cloud-command-payloads";
import { assertStillCurrent } from "./cloud-command-polling";
import {
  assertCommandAccepted,
  isRejectedCommandStatus,
} from "./cloud-command-status";
import { applyPendingSessionConfigUpdates } from "./pending-home-prompt-session-config";
import { enqueuePromptWithRetry } from "./pending-home-prompt-send";
import { startSessionForPrompt } from "./pending-home-prompt-session-start";

export type {
  EnqueueCloudCommand,
  PendingHomePromptDispatchResult,
  SendPromptPayload,
  StartSessionPayload,
  UpdateSessionConfigPayload,
} from "./cloud-command-payloads";
export {
  assertWorkspaceCanAcceptCloudCommands,
  ensureManagedWorkspaceTargetConfigReady,
  prepareManagedWorkspaceForCloudCommands,
} from "./managed-workspace-command-readiness";
export {
  isRecoverableCloudDispatchError,
  isRejectedCommandStatus,
} from "./cloud-command-status";
export { enqueuePromptCommandWithRetry } from "./pending-home-prompt-send";

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
