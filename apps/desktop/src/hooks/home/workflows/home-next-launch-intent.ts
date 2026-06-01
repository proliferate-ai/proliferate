import {
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingWorkspaceId,
  type ChatLaunchRetryMode,
} from "@/lib/domain/chat/launch/launch-intent";
import type { HomeNextModelSelection } from "@/lib/domain/home/home-next-launch";
import type { PendingWorkspaceInitialSession } from "@/lib/domain/workspaces/creation/pending-entry";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function homeNextLaunchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function modeOptions(modeId: string | null): { modeId?: string } {
  return modeId ? { modeId } : {};
}

export function newHomeNextLaunchId(): string {
  return crypto.randomUUID();
}

export function buildResolvedHomeLaunchControlValues(input: {
  modeId: string | null;
  launchControlValues?: Record<string, string>;
}): Record<string, string> {
  return {
    ...input.launchControlValues,
    ...(input.modeId ? { mode: input.modeId } : {}),
  };
}

export function buildHomePendingWorkspaceInitialSession(input: {
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues: Record<string, string>;
}): PendingWorkspaceInitialSession {
  return {
    kind: "session",
    agentKind: input.modelSelection.kind,
    modelId: input.modelSelection.modelId,
    modeId: input.modeId,
    launchControlValues: input.launchControlValues,
    displayTitle: input.modelSelection.modelId,
  };
}

export function markHomeLaunchIntentMaterializedFromPendingWorkspace(intentId: string): void {
  const activeIntent = useChatLaunchIntentStore.getState().activeIntent;
  if (!activeIntent || activeIntent.id !== intentId) {
    return;
  }

  const workspaceId = resolveLaunchIntentPendingWorkspaceId(
    activeIntent,
    useSessionSelectionStore.getState().pendingWorkspaceEntry,
  );
  if (!workspaceId) {
    return;
  }

  useChatLaunchIntentStore.getState().markMaterializedIfActive(intentId, {
    workspaceId,
  });
}

export function homeLaunchFailureRetryMode(intentId: string): ChatLaunchRetryMode {
  const activeIntent = useChatLaunchIntentStore.getState().activeIntent;
  if (!activeIntent || activeIntent.id !== intentId) {
    return "safe";
  }

  const retryMode = resolveChatLaunchRetryMode(activeIntent);
  if (retryMode !== "safe") {
    return retryMode;
  }

  return resolveLaunchIntentPendingWorkspaceId(
    activeIntent,
    useSessionSelectionStore.getState().pendingWorkspaceEntry,
  )
    ? "manual_after_workspace"
    : "safe";
}
