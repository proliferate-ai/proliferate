import type {
  CloudSessionProjection,
  CloudWorkspaceDetail,
  ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import {
  DEFAULT_DIRECT_PROMPT_AGENT_KIND,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import type { PendingHomePrompt } from "../cloud/pending-home-prompt-store";
import { getWebCloudSandboxAnyHarnessClient } from "./cloud-sandbox-runtime";

export async function startCloudSandboxPendingHomePrompt(args: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail;
  pendingPrompt: PendingHomePrompt;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<{ sessionId: string }> {
  args.onStatus("Preparing cloud sandbox runtime.");
  const { connection, anyharness } = await getWebCloudSandboxAnyHarnessClient({
    workspace: args.workspace,
    productToken: args.productToken,
    client: args.client,
  });
  assertCurrent(args.shouldContinue);
  args.onStatus("Starting session.");
  const session = await anyharness.sessions.create({
    workspaceId: connection.anyharnessWorkspaceId,
    agentKind: args.pendingPrompt.agentKind ?? DEFAULT_DIRECT_PROMPT_AGENT_KIND,
    ...(args.pendingPrompt.modelId ? { modelId: args.pendingPrompt.modelId } : {}),
    ...(args.pendingPrompt.modeId ? { modeId: args.pendingPrompt.modeId } : {}),
    subagentsEnabled: false,
    origin: { kind: "system", entrypoint: "cloud" },
  });
  for (const update of args.pendingPrompt.sessionConfigUpdates ?? []) {
    await anyharness.sessions.setConfigOption(session.id, update);
  }
  assertCurrent(args.shouldContinue);
  args.onStatus("Sending prompt.");
  await anyharness.sessions.prompt(session.id, {
    blocks: [{ type: "text", text: args.pendingPrompt.text }],
    promptId: args.pendingPrompt.id,
  });
  args.onStatus("Queued prompt; waiting for transcript.");
  return { sessionId: session.id };
}

export async function resumeCloudSandboxPendingHomePrompt(args: {
  client: ProliferateCloudClient;
  productToken: string | null;
  workspace: CloudWorkspaceDetail;
  session: CloudSessionProjection;
  pendingPrompt: PendingHomePrompt;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<{ sessionId: string }> {
  args.onStatus("Preparing cloud sandbox runtime.");
  const { anyharness } = await getWebCloudSandboxAnyHarnessClient({
    workspace: args.workspace,
    productToken: args.productToken,
    client: args.client,
  });
  for (const update of args.pendingPrompt.sessionConfigUpdates ?? []) {
    await anyharness.sessions.setConfigOption(args.session.sessionId, update);
  }
  assertCurrent(args.shouldContinue);
  args.onStatus("Sending queued prompt.");
  await anyharness.sessions.prompt(args.session.sessionId, {
    blocks: [{ type: "text", text: args.pendingPrompt.text }],
    promptId: args.pendingPrompt.id,
  });
  args.onStatus("Queued prompt; waiting for transcript.");
  return { sessionId: args.session.sessionId };
}

function assertCurrent(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Action was cancelled.");
  }
}
