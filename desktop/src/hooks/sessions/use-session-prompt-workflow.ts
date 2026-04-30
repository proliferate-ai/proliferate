import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type { ContentPart, PromptInputBlock } from "@anyharness/sdk";
import { useCallback } from "react";
import {
  createOptimisticPendingPrompt,
  shouldClearOptimisticPromptAfterPromptResponse,
} from "@/lib/domain/chat/pending-prompts";
import { getSessionClientAndWorkspace, isPendingSessionId } from "@/lib/integrations/anyharness/session-runtime";
import {
  finishLatencyFlow,
  getLatencyFlowRequestHeaders,
} from "@/lib/infra/latency-flow";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useSessionTitleActions } from "@/hooks/sessions/use-session-title-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";

interface PromptSessionInput {
  sessionId: string;
  text: string;
  blocks?: PromptInputBlock[];
  optimisticContentParts?: ContentPart[];
  workspaceId?: string | null;
  latencyFlowId?: string | null;
  promptId?: string | null;
  onBeforeOptimisticPrompt?: (workspaceId: string) => Promise<void> | void;
  onBeforePrompt?: (workspaceId: string) => Promise<void> | void;
  onBeforePromptRequest?: (workspaceId: string) => Promise<void> | void;
}

export function useSessionPromptWorkflow() {
  const { maybeGenerateSessionTitle } = useSessionTitleActions();
  const { applySessionSummary, ensureSessionStreamConnected } =
    useSessionRuntimeActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();

  const promptSession = useCallback(async ({
    sessionId,
    text,
    blocks,
    optimisticContentParts,
    workspaceId,
    latencyFlowId,
    promptId,
    onBeforeOptimisticPrompt,
    onBeforePrompt,
    onBeforePromptRequest,
  }: PromptSessionInput) => {
    const slot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
    const resolvedWorkspaceId = workspaceId ?? slot?.workspaceId ?? null;
    const requestHeaders = getLatencyFlowRequestHeaders(latencyFlowId);
    const requestOptions = requestHeaders ? { headers: requestHeaders } : undefined;

    if (isPendingSessionId(sessionId)) {
      return;
    }

    try {
      if (resolvedWorkspaceId && onBeforeOptimisticPrompt) {
        await onBeforeOptimisticPrompt(resolvedWorkspaceId);
      }

      useHarnessStore.getState().patchSessionSlot(sessionId, {
        optimisticPrompt:
          slot?.optimisticPrompt
          ?? createOptimisticPendingPrompt(
            text,
            promptId ?? null,
            undefined,
            optimisticContentParts,
          ),
      });
      finishLatencyFlow(latencyFlowId, "optimistic_visible");

      const shouldGenerateTitle = !slot?.lastPromptAt;
      if (resolvedWorkspaceId && onBeforePrompt) {
        await onBeforePrompt(resolvedWorkspaceId);
      }

      const { connection, workspaceId: promptWorkspaceId } = await getSessionClientAndWorkspace(
        sessionId,
      );
      if (onBeforePromptRequest) {
        await onBeforePromptRequest(promptWorkspaceId);
      }
      const response = await getAnyHarnessClient(connection).sessions.prompt(
        sessionId,
        { blocks: blocks ?? [{ type: "text", text }] },
        requestOptions,
      );

      applySessionSummary(sessionId, response.session, promptWorkspaceId);
      upsertWorkspaceSessionRecord(promptWorkspaceId, response.session);
      if (shouldClearOptimisticPromptAfterPromptResponse(response.status)) {
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          optimisticPrompt: null,
        });
      }

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
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        optimisticPrompt: null,
        status: "idle",
      });
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
