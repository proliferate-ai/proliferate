import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { generateSessionTitle } from "@/lib/access/cloud/ai-magic";
import { getSessionClientAndWorkspace } from "@/lib/integrations/anyharness/session-runtime";
import {
  finishMeasurementOperation,
  getMeasurementRequestOptions,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import { useAuthStore } from "@/stores/auth/auth-store";

const requestedAutoSessionTitles = new Map<string, number>();
const MAX_TRACKED_AUTO_SESSION_TITLES = 500;

function markAutoSessionTitleRequested(sessionId: string): boolean {
  if (requestedAutoSessionTitles.has(sessionId)) {
    return true;
  }

  requestedAutoSessionTitles.set(sessionId, Date.now());
  while (requestedAutoSessionTitles.size > MAX_TRACKED_AUTO_SESSION_TITLES) {
    const oldestSessionId = requestedAutoSessionTitles.keys().next().value;
    if (!oldestSessionId) {
      break;
    }
    requestedAutoSessionTitles.delete(oldestSessionId);
  }

  return false;
}

export function useSessionTitleActions() {
  const { applySessionSummary } = useSessionRuntimeActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Chat title cannot be empty.");
    }

    const { connection, workspaceId, materializedSessionId } =
      await getSessionClientAndWorkspace(sessionId);
    const operationId = startMeasurementOperation({
      kind: "session_rename",
      surfaces: ["header-tabs", "workspace-sidebar", "chat-surface"],
      maxDurationMs: 10_000,
    });
    const session = await getAnyHarnessClient(connection).sessions.updateTitle(
      materializedSessionId,
      { title: trimmedTitle },
      getMeasurementRequestOptions({ operationId, category: "session.title.update" }),
    );

    const storeStartedAt = performance.now();
    applySessionSummary(sessionId, session, workspaceId);
    upsertWorkspaceSessionRecord(workspaceId, session);
    if (operationId) {
      recordMeasurementMetric({
        type: "store",
        category: "session.title.update",
        operationId,
        durationMs: performance.now() - storeStartedAt,
      });
      finishMeasurementOperation(operationId, "completed");
    }

    return session;
  }, [applySessionSummary, upsertWorkspaceSessionRecord]);

  const maybeGenerateSessionTitle = useCallback(async (input: {
    sessionId: string;
    firstUserMessage: string;
  }) => {
    if (markAutoSessionTitleRequested(input.sessionId)) {
      return;
    }

    const trimmedPrompt = input.firstUserMessage.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (useAuthStore.getState().status !== "authenticated") {
      return;
    }

    try {
      const response = await generateSessionTitle(trimmedPrompt);
      const title = response.title?.trim();
      if (!title) {
        return;
      }
      await updateSessionTitle(input.sessionId, title);
    } catch {
      // Best-effort title generation should never block chat.
    }
  }, [updateSessionTitle]);

  return {
    updateSessionTitle,
    maybeGenerateSessionTitle,
  };
}
