import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { getSessionClientAndWorkspace, isPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/latency-flow";

interface PromptSessionInput {
  sessionId: string;
  text: string;
  workspaceId?: string | null;
  latencyFlowId?: string | null;
  promptId?: string | null;
  onBeforePrompt?: (workspaceId: string) => Promise<void> | void;
}

export function useSessionPromptWorkflow() {
  const { maybeGenerateSessionTitle } = useSessionTitleActions();
  const { applySessionSummary, ensureSessionStreamConnected } =
    useSessionRuntimeActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();

  const promptSession = useCallback(async ({
    sessionId,
    text,
    workspaceId,
    latencyFlowId,
    onBeforePrompt,
  }: PromptSessionInput) => {
    const slot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
    const resolvedWorkspaceId = workspaceId ?? slot?.workspaceId ?? null;
    const requestHeaders = getLatencyFlowRequestHeaders(latencyFlowId);
    const requestOptions = requestHeaders ? { headers: requestHeaders } : undefined;

    if (isPendingSessionId(sessionId)) {
      return;
    }

    try {
      const shouldGenerateTitle = !slot?.lastPromptAt;
      if (resolvedWorkspaceId && onBeforePrompt) {
        await onBeforePrompt(resolvedWorkspaceId);
      }

      const { connection, workspaceId: promptWorkspaceId } = await getSessionClientAndWorkspace(
        sessionId,
      );
      const response = await getAnyHarnessClient(connection).sessions.promptText(
        sessionId,
        text,
        requestOptions,
      );

      applySessionSummary(sessionId, response.session, promptWorkspaceId);
      upsertWorkspaceSessionRecord(promptWorkspaceId, response.session);

      if (shouldGenerateTitle) {
        void maybeGenerateSessionTitle({
          sessionId,
          firstUserMessage: text,
        });
      }

      void ensureSessionStreamConnected(sessionId, {
        resumeIfActive: false,
        requestHeaders,
      });
    } catch (error) {
      useHarnessStore.getState().patchSessionSlot(sessionId, { status: "idle" });
      throw error;
    }
  }, [
    applySessionSummary,
    ensureSessionStreamConnected,
    maybeGenerateSessionTitle,
    upsertWorkspaceSessionRecord,
  ]);

  return {
    promptSession,
  };
}
