import {
  getWorkspaceSnapshot,
  materializeTargetConfig,
  type AgentAuthAgentKind,
  type CloudWorkspaceDetail,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import { cloudCommandReadiness } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

import { ensurePersonalAgentAuthLaunchReady } from "./agent-auth-launch-readiness";
import { assertCommandAccepted } from "./cloud-command-status";
import {
  assertStillCurrent,
  nextPollDelay,
  sleep,
  waitForCommandTerminal,
} from "./cloud-command-polling";

export async function prepareManagedWorkspaceForCloudCommands(args: {
  client: ProliferateCloudClient;
  workspace: CloudWorkspaceDetail;
  agentKind: string;
  modelId?: string | null;
  idempotencyKey: string;
  setLatestCommandId: (commandId: string) => void;
  onStatus: (status: string) => void;
  shouldContinue: () => boolean;
}): Promise<CloudWorkspaceDetail> {
  let workspace = args.workspace;
  if (workspace.sandboxType === "managed_personal") {
    await ensurePersonalManagedAgentAuthReady({
      client: args.client,
      agentKind: args.agentKind,
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
  assertWorkspaceCanAcceptCloudCommands(workspace);
  await ensureManagedWorkspaceTargetConfigReady({
    client: args.client,
    workspace,
    idempotencyKey: args.idempotencyKey,
    setLatestCommandId: args.setLatestCommandId,
    onStatus: args.onStatus,
    shouldContinue: args.shouldContinue,
  });
  return workspace;
}

export async function ensureManagedWorkspaceTargetConfigReady(
  args: {
    client: ProliferateCloudClient;
    workspace: CloudWorkspaceDetail;
    idempotencyKey: string;
    setLatestCommandId: (commandId: string) => void;
    onStatus: (status: string) => void;
    shouldContinue: () => boolean;
  },
): Promise<void> {
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
      source: "web",
      idempotencyKey: args.idempotencyKey,
    },
    args.client,
  );
  args.setLatestCommandId(response.command.commandId);
  args.onStatus("Applying managed target configuration.");
  assertCommandAccepted(
    await waitForCommandTerminal(
      response.command.commandId,
      args.client,
      args.shouldContinue,
      args.onStatus,
    ),
  );
}

export function assertWorkspaceCanAcceptCloudCommands(
  workspace: CloudWorkspaceDetail,
): void {
  const readiness = cloudCommandReadiness(workspace);
  if (readiness.commandable) {
    return;
  }
  throw new Error(readiness.message ?? "This workspace cannot accept cloud commands right now.");
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
      throw new Error("Timed out waiting for cloud agent credentials to apply.");
    }
    await sleep(delayMs);
    delayMs = nextPollDelay(delayMs);
    latest = (await getWorkspaceSnapshot(args.workspaceId, args.client)).workspace;
  }
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

function shouldMaterializeManagedTargetConfig(workspace: CloudWorkspaceDetail): boolean {
  if (workspace.sandboxType === "managed_shared") {
    return false;
  }
  if (workspace.sandboxType !== "managed_personal") {
    return false;
  }
  const runtimeAuth = workspace.runtime?.runtimeAuth;
  if (!runtimeAuth) {
    return false;
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
