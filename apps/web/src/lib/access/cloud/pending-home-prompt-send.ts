import type {
  CloudCommandEnvelope,
  CloudCommandResponse,
  CloudSessionProjection,
  CloudWorkspaceDetail,
} from "@proliferate/cloud-sdk";

import type { PendingHomePrompt } from "./pending-home-prompt-store";
import type { EnqueueCloudCommand, SendPromptPayload } from "./cloud-command-payloads";
import {
  assertStillCurrent,
  sleep,
} from "./cloud-command-polling";
import { isRecoverableCloudDispatchError } from "./cloud-command-status";

export async function enqueuePromptWithRetry(args: {
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
