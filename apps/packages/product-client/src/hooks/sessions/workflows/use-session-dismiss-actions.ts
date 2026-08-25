import { useCallback } from "react";
import { AnyHarnessError } from "@anyharness/sdk";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useDismissSessionMutation } from "@anyharness/sdk-react";
import { useDismissedSessionCleanup } from "#product/hooks/sessions/workflows/use-dismissed-session-cleanup";
import { useWorkspaceRuntimeBlock } from "#product/hooks/workspaces/derived/use-workspace-runtime-block";
import { getSessionClientAndWorkspace } from "#product/lib/access/anyharness/session-runtime";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import type {
  VisibleChatSessionDismissOptions,
} from "#product/lib/workflows/workspaces/chat-session-archive";
import { isWorkspaceSetupSessionId } from "#product/lib/domain/workspaces/selection/setup-session";

export function isSessionAlreadyGone(error: unknown): boolean {
  return error instanceof AnyHarnessError && error.problem.status === 404;
}

export function useSessionDismissActions() {
  const host = useProductHost();
  const cloudClient = host.cloud.client;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const cleanupDismissedSession = useDismissedSessionCleanup();
  const dismissSessionMutation = useDismissSessionMutation();

  const dismissSession = useCallback(async (
    sessionId: string,
    options?: VisibleChatSessionDismissOptions,
  ): Promise<boolean> => {
    if (isWorkspaceSetupSessionId(sessionId)) {
      return false;
    }
    const state = useSessionSelectionStore.getState();
    const closingSlot = getSessionRecord(sessionId);
    const workspaceId = closingSlot?.workspaceId ?? state.selectedWorkspaceId;

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return false;
    }

    try {
      const { materializedSessionId, workspaceId: resolvedWorkspaceId } =
        await getSessionClientAndWorkspace(sessionId, cloudClient);
      await dismissSessionMutation.mutateAsync({
        workspaceId: resolvedWorkspaceId,
        sessionId: materializedSessionId,
      });
    } catch (error) {
      // A session the runtime no longer knows is already dismissed; any other
      // failure keeps local state intact so the surface can offer a retry
      // instead of reporting a deletion that did not happen.
      if (!isSessionAlreadyGone(error)) {
        showToast(error instanceof Error ? error.message : String(error));
        return false;
      }
    }

    cleanupDismissedSession(sessionId, workspaceId, options);
    return true;
  }, [
    cleanupDismissedSession,
    dismissSessionMutation,
    getWorkspaceRuntimeBlockReason,
    showToast,
    cloudClient,
  ]);

  return { dismissSession };
}
