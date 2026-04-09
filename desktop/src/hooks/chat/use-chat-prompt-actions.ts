import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { anyHarnessWorkspaceSetupStatusKey } from "@anyharness/sdk-react";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useActiveChatSessionState } from "./use-active-chat-session-state";
import { useChatAvailabilityState } from "./use-chat-availability-state";
import { useConfiguredLaunchReadiness } from "./use-configured-launch-readiness";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

function createPromptId(): string {
  return `prompt:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function isSetupActive(
  queryClient: ReturnType<typeof useQueryClient>,
  runtimeUrl: string,
  workspaceId: string | null,
): boolean {
  if (!workspaceId) return false;
  const arrival = useHarnessStore.getState().workspaceArrivalEvent;
  if (!arrival || arrival.workspaceId !== workspaceId) return false;

  const cachedStatus = queryClient.getQueryData<{ status?: string }>(
    anyHarnessWorkspaceSetupStatusKey(runtimeUrl, workspaceId),
  );
  const status = cachedStatus?.status ?? arrival.setupScript?.status ?? null;
  // For async-setup sources the creation endpoint returns setupScript: null
  // and setup runs in the background. Treat a cache miss (no poll result yet)
  // as potentially active so the panel isn't prematurely dismissed before the
  // first setup-status poll returns.
  const isAsyncSetupSource =
    arrival.source === "worktree-created" || arrival.source === "local-created";
  if (isAsyncSetupSource && status === null) return true;
  return status === "running" || status === "queued";
}

export function useChatPromptActions() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const { cancelActiveSession, findOrCreateSession, promptActiveSession } = useSessionActions();
  const clearDraft = useChatInputStore((state) => state.clearDraft);
  const {
    activeSessionId,
    activeSlot,
    currentLaunchIdentity,
    isRunning,
  } = useActiveChatSessionState();
  const { isDisabled } = useChatAvailabilityState();
  const configuredLaunch = useConfiguredLaunchReadiness(currentLaunchIdentity);

  const handleSubmit = useCallback(async () => {
    if (!selectedWorkspaceId) {
      return;
    }

    const currentDraft = useChatInputStore.getState().draftByWorkspaceId[selectedWorkspaceId] ?? "";
    const text = currentDraft.trim();
    if (!text || isDisabled || isRunning) {
      return;
    }

    const launchSelection = currentLaunchIdentity ?? configuredLaunch.selection;
    const targetSessionId = activeSlot ? activeSessionId : null;
    const promptId = createPromptId();
    const latencyFlowId = targetSessionId
      ? startLatencyFlow({
        flowKind: "prompt_submit",
        source: "composer_submit",
        targetWorkspaceId: selectedWorkspaceId,
        targetSessionId,
        promptId,
      })
      : null;

    // Optimistically clear the draft immediately so the input empties at the
    // same instant the pending user bubble appears in the transcript.
    // If the send fails, the error toast below covers the failure path.
    clearDraft(selectedWorkspaceId);

    try {
      if (targetSessionId) {
        await promptActiveSession(text, {
          latencyFlowId: latencyFlowId ?? undefined,
          promptId,
        });
      } else if (launchSelection) {
        await findOrCreateSession(launchSelection.kind, text, launchSelection.modelId);
      } else {
        showToast("Choose a ready model before sending a message.");
        return;
      }
      // Keep the arrival panel visible while a setup script is still
      // running/queued — the user needs to see setup progress even after
      // sending their first message. Only dismiss when setup is idle.
      if (!isSetupActive(queryClient, runtimeUrl, selectedWorkspaceId)) {
        setWorkspaceArrivalEvent(null);
      }
      trackProductEvent("chat_prompt_submitted", {
        workspace_kind: parseCloudWorkspaceSyntheticId(selectedWorkspaceId) ? "cloud" : "local",
        agent_kind: launchSelection?.kind ?? "unknown",
        reuse_session: targetSessionId !== null,
      });
    } catch (error) {
      if (latencyFlowId) {
        failLatencyFlow(latencyFlowId, "prompt_submit_failed");
      }
      captureTelemetryException(error, {
        tags: {
          action: "prompt_active_session",
          domain: "chat",
        },
      });

      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to send message: ${message}`);
    }
  }, [
    activeSessionId,
    activeSlot,
    clearDraft,
    configuredLaunch.selection,
    currentLaunchIdentity,
    findOrCreateSession,
    isDisabled,
    isRunning,
    promptActiveSession,
    queryClient,
    runtimeUrl,
    selectedWorkspaceId,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  const handleCancel = useCallback(() => {
    void cancelActiveSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`Failed to cancel message: ${message}`);
    });
  }, [cancelActiveSession, showToast]);

  return {
    handleSubmit,
    handleCancel,
  };
}
