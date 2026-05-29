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
  getWorkspaceArrivalEvent: () => WorkspaceArrivalEvent | null;
  getCachedWorkspaceSetupStatus: (workspaceId: string) => CachedWorkspaceSetupStatus;
  agentKind: string;
  reuseSession: boolean;
  setWorkspaceArrivalEvent: (event: null) => void;
}

interface CompleteChatPromptSubmitSideEffectsDeps {
  trackProductEvent: TrackChatPromptSubmitted;
}

export function completeChatPromptSubmitSideEffects(
  {
    workspaceId,
    getWorkspaceArrivalEvent,
    getCachedWorkspaceSetupStatus,
    agentKind,
    reuseSession,
    setWorkspaceArrivalEvent,
  }: CompleteChatPromptSubmitSideEffectsInput,
  { trackProductEvent }: CompleteChatPromptSubmitSideEffectsDeps,
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
}
