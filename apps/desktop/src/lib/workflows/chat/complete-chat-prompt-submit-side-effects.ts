import { isWorkspaceSetupActive } from "@/lib/domain/chat/submit/workspace-setup-activity";
import type { CachedWorkspaceSetupStatus } from "@/lib/domain/chat/submit/workspace-setup-activity";
import type { DesktopProductEventMap } from "@/lib/domain/telemetry/events";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";

type TrackChatPromptSubmitted = (
  name: "chat_prompt_submitted",
  properties: DesktopProductEventMap["chat_prompt_submitted"],
) => void;

interface CompleteChatPromptSubmitSideEffectsInput {
  workspaceId: string;
  logicalWorkspaceId: string | null;
  repoRootId: string | null;
  getWorkspaceArrivalEvent: () => WorkspaceArrivalEvent | null;
  getCachedWorkspaceSetupStatus: (workspaceId: string) => CachedWorkspaceSetupStatus;
  agentKind: string;
  reuseSession: boolean;
  setWorkspaceArrivalEvent: (event: null) => void;
}

interface CompleteChatPromptSubmitSideEffectsDeps {
  trackProductEvent: TrackChatPromptSubmitted;
  /** Writes the current composed git status into the persisted snapshot. */
  captureGitStatusSnapshot: (logicalWorkspaceId: string, at: string) => void;
  /** Stamps lastPromptAt on the persisted snapshot. */
  stampGitPrompt: (logicalWorkspaceId: string, at: string) => void;
  /** Kicks a refresh=1 PR status fetch for the workspace's repo root. */
  refreshPrStatuses: (repoRootId: string) => void;
}

export function completeChatPromptSubmitSideEffects(
  {
    workspaceId,
    logicalWorkspaceId,
    repoRootId,
    getWorkspaceArrivalEvent,
    getCachedWorkspaceSetupStatus,
    agentKind,
    reuseSession,
    setWorkspaceArrivalEvent,
  }: CompleteChatPromptSubmitSideEffectsInput,
  {
    trackProductEvent,
    captureGitStatusSnapshot,
    stampGitPrompt,
    refreshPrStatuses,
  }: CompleteChatPromptSubmitSideEffectsDeps,
): void {
  if (!isWorkspaceSetupActive({
    workspaceArrivalEvent: getWorkspaceArrivalEvent(),
    workspaceId,
    cachedSetupStatus: getCachedWorkspaceSetupStatus(workspaceId),
  })) {
    setWorkspaceArrivalEvent(null);
  }
  trackProductEvent("chat_prompt_submitted", {
    workspace_kind: parseCloudWorkspaceSyntheticId(workspaceId) ? "cloud" : "local",
    agent_kind: agentKind,
    reuse_session: reuseSession,
  });

  // "Last status at message send": capture latest-known truth anchored to the
  // prompt, then kick a refresh=1 fetch so the true at-send state lands
  // within seconds (10s daemon floor).
  const promptedAt = new Date().toISOString();
  if (logicalWorkspaceId) {
    captureGitStatusSnapshot(logicalWorkspaceId, promptedAt);
    stampGitPrompt(logicalWorkspaceId, promptedAt);
  }
  if (repoRootId) {
    refreshPrStatuses(repoRootId);
  }
}
