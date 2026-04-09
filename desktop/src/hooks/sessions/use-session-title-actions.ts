import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { generateSessionTitle } from "@/lib/integrations/cloud/ai-magic";
import { getSessionClientAndWorkspace } from "@/lib/integrations/anyharness/session-runtime";
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

    const { connection, workspaceId } = await getSessionClientAndWorkspace(sessionId);
    const session = await getAnyHarnessClient(connection).sessions.updateTitle(sessionId, {
      title: trimmedTitle,
    });

    applySessionSummary(sessionId, session, workspaceId);
    upsertWorkspaceSessionRecord(workspaceId, session);

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
