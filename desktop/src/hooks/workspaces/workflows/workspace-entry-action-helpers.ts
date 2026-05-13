import type { Workspace } from "@anyharness/sdk";
import type {
  PendingWorkspaceInitialSession,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  collectWorktreeBasenamesForRepo,
  generateWorkspaceSlug,
} from "@/lib/domain/workspaces/creation/arrival";
import type {
  CreateWorktreeWorkspaceInput,
} from "@/lib/domain/workspaces/creation/workspace-creation";
import { resolveModelDisplayName } from "@/lib/domain/chat/models/model-display";

export function resolveDisplayNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "workspace";
}

export function normalizeWorktreeInput(
  input: string | CreateWorktreeWorkspaceInput,
  source: Workspace | null,
  allWorkspaces: readonly Workspace[],
): CreateWorktreeWorkspaceInput {
  const existingBasenames = source
    ? collectWorktreeBasenamesForRepo(allWorkspaces, source)
    : new Set<string>();

  if (typeof input === "string") {
    return {
      repoRootId: input,
      workspaceName: generateWorkspaceSlug(existingBasenames),
    };
  }

  return {
    ...input,
    workspaceName: input.workspaceName?.trim() || generateWorkspaceSlug(existingBasenames),
  };
}

export function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function displayTitleForPendingSession(agentKind: string, modelId: string): string {
  return resolveModelDisplayName({
    agentKind,
    modelId,
    preferKnownAlias: true,
  }) ?? modelId;
}

export function buildPendingInitialSession(input: {
  agentKind: string | null | undefined;
  modelId: string | null | undefined;
  modeId?: string | null;
  displayTitle?: string | null;
}): PendingWorkspaceInitialSession | null {
  const agentKind = input.agentKind?.trim();
  const modelId = input.modelId?.trim();
  if (!agentKind || !modelId) {
    return null;
  }

  return {
    kind: "session",
    agentKind,
    modelId,
    modeId: input.modeId ?? null,
    displayTitle: input.displayTitle ?? displayTitleForPendingSession(agentKind, modelId),
  };
}
