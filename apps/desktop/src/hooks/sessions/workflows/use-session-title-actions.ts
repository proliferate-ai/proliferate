import { useCallback, useRef } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useUpdateSessionTitleMutation } from "@anyharness/sdk-react";
import { generateSessionTitle } from "@proliferate/cloud-sdk/client/ai-magic";
import { getSessionClientAndWorkspace } from "@/lib/access/anyharness/session-runtime";
import {
  finishMeasurementOperation,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useProductAuthStatus } from "@/hooks/auth/facade/use-product-auth";

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
  const ssh = useProductHost().desktop?.ssh ?? null;
  // Auto-title generation runs outside render; read the latest normalized auth
  // status through a ref so the callback identity stays stable (matching the
  // former non-reactive the Desktop auth store read).
  const authStatus = useProductAuthStatus();
  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;
  const { applySessionSummary } = useSessionSummaryActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const updateSessionTitleMutation = useUpdateSessionTitleMutation();

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Chat title cannot be empty.");
    }

    const { workspaceId, materializedSessionId } =
      await getSessionClientAndWorkspace(sessionId, ssh);
    const operationId = startMeasurementOperation({
      kind: "session_rename",
      surfaces: ["header-tabs", "workspace-sidebar", "chat-surface"],
      maxDurationMs: 10_000,
    });
    const session = await updateSessionTitleMutation.mutateAsync({
      workspaceId,
      sessionId: materializedSessionId,
      request: { title: trimmedTitle },
      requestOptions: getMeasurementRequestOptions({
        operationId,
        category: "session.title.update",
      }) ?? undefined,
    });

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
  }, [applySessionSummary, ssh, updateSessionTitleMutation, upsertWorkspaceSessionRecord]);

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
    if (authStatusRef.current !== "authenticated") {
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
