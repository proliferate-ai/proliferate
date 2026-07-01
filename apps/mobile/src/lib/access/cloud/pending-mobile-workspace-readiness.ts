import {
  getWorkspaceSnapshot,
  materializeTargetConfig,
  type AgentAuthAgentKind,
  type CloudCommandResponse,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { ensurePersonalAgentAuthLaunchReady } from "./agent-auth-launch-readiness";
import {
  assertCommandAccepted,
  waitForCommandTerminal,
} from "./pending-mobile-command-status";
import {
  RetryablePendingPromptDispatchError,
} from "./pending-mobile-prompt-errors";
import {
  assertStillCurrent,
  nextPollDelay,
  sleep,
} from "./pending-mobile-prompt-polling";

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
      agentKind: args.agentKind ?? resolvePendingMobilePromptAgentKind(args.workspace),
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

export function resolvePendingMobilePromptAgentKind(workspace: CloudWorkspaceDetail): string {
  if (workspace.readyAgentKinds?.includes("codex")) {
    return "codex";
  }
  return workspace.readyAgentKinds?.[0] ?? workspace.allowedAgentKinds?.[0] ?? "codex";
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

function normalizeAgentAuthAgentKind(agentKind: string): AgentAuthAgentKind | null {
  return agentKind === "claude"
    || agentKind === "codex"
    || agentKind === "opencode"
    || agentKind === "gemini"
    ? agentKind
    : null;
}
