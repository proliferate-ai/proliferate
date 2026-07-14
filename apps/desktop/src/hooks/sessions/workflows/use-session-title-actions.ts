import { useCallback } from "react";
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
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
  const authStatus = host.auth.state.status;
  const { applySessionSummary } = useSessionSummaryActions();
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const updateSessionTitleMutation = useUpdateSessionTitleMutation();

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      throw new Error("Chat title cannot be empty.");
    }

    const { workspaceId, materializedSessionId } =
      await getSessionClientAndWorkspace(sessionId, ssh, cloudClient);
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
  }, [
    applySessionSummary,
    cloudClient,
    ssh,
    updateSessionTitleMutation,
    upsertWorkspaceSessionRecord,
  ]);

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
    if (authStatus !== "authenticated" || !cloudClient) {
      return;
    }

    try {
      const response = await generateSessionTitle(trimmedPrompt, cloudClient);
      const title = response.title?.trim();
      if (!title) {
        return;
      }
      await updateSessionTitle(input.sessionId, title);
    } catch {
      // Best-effort title generation should never block chat.
    }
  }, [authStatus, cloudClient, updateSessionTitle]);

  return {
    updateSessionTitle,
    maybeGenerateSessionTitle,
  };
}
