import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useChatPromptRecoveryStore } from "@/stores/chat/chat-prompt-recovery-store";
import {
  getPromptOutboxEntriesForSession,
  useSessionIntentStore,
} from "@/stores/sessions/session-intent-store";
import {
  markProjectedSessionPromptCreateFailed,
} from "@/hooks/sessions/workflows/session-creation-failure";
import {
  removeSessionRecordAndClearSelection,
} from "@/hooks/sessions/workflows/session-creation-local-state";
import type {
  EmptySessionReplacementTransaction,
} from "@/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import type {
  ReplacementShellPreferencesTransaction,
} from "@/hooks/sessions/workflows/session-replacement-shell-preferences";

interface SessionCreationFailureCleanupInput {
  agentKind: string;
  currentOwnedSessionId: string | null;
  error: unknown;
  hadExistingProjectedRecord: boolean;
  hasPrompt: boolean;
  launchIntentId?: string | null;
  modeId: string | null;
  modelId: string;
  pendingSessionId: string;
  preserveProjectedSessionOnCreateFailure: boolean;
  previousActiveSessionId: string | null;
  recoveryWorkspaceUiKey: string;
  replacementShellPreferences: ReplacementShellPreferencesTransaction | null;
  replacementTransaction: EmptySessionReplacementTransaction | null;
  rollbackOwnedShellIntent: () => boolean;
  workspaceId: string;
}

interface SessionCreationFailureCleanupDeps {
  activateSession: (sessionId: string) => void;
}

export function cleanupSessionCreationFailure(
  input: SessionCreationFailureCleanupInput,
  deps: SessionCreationFailureCleanupDeps,
): void {
  logLatency("session.create.failed", {
    clientSessionId: input.pendingSessionId,
    workspaceId: input.workspaceId,
    agentKind: input.agentKind,
    modelId: input.modelId,
    hasPrompt: input.hasPrompt,
    hasExistingProjectedRecord: input.hadExistingProjectedRecord,
    errorMessage: input.error instanceof Error
      ? input.error.message
      : String(input.error),
  });

  if (input.replacementTransaction) {
    const activeSessionIdBeforeRemoval = useSessionSelectionStore.getState().activeSessionId;
    const acquiredPrompts = getPromptOutboxEntriesForSession(input.pendingSessionId)
      .filter((entry) => (
        entry.dispatchedAt === null
        && entry.deliveryState !== "cancelled"
        && entry.deliveryState !== "echoed_tombstone"
      ));
    if (acquiredPrompts.length > 0) {
      // The replacement began empty, but the still-usable composer may have
      // queued work while it materialized. Move the complete payload into a
      // workspace-scoped recovery surface before removing the failed shell.
      const errorMessage = input.error instanceof Error && input.error.message.trim()
        ? input.error.message
        : "Session creation failed.";
      useChatPromptRecoveryStore.getState().addRecoveries(
        input.recoveryWorkspaceUiKey,
        acquiredPrompts.map((prompt) => ({
          id: prompt.clientPromptId,
          workspaceId: input.workspaceId,
          agentKind: input.agentKind,
          modelId: input.modelId,
          modeId: input.modeId,
          errorMessage,
          prompt,
        })),
      );
    }
    useSessionIntentStore.getState().clearSession(input.pendingSessionId);
    removeSessionRecordAndClearSelection(input.pendingSessionId);
    const rolledBackShellIntent = input.rollbackOwnedShellIntent();
    input.replacementShellPreferences?.rollback();
    input.replacementTransaction.rollback();
    if (
      rolledBackShellIntent
      && activeSessionIdBeforeRemoval === input.currentOwnedSessionId
      && input.previousActiveSessionId
      && getSessionRecord(input.previousActiveSessionId)
    ) {
      deps.activateSession(input.previousActiveSessionId);
    }
    clearLaunchIntent(input.launchIntentId);
    captureCreationFailure(input.error, "replace_empty_session");
    return;
  }

  if (input.hasPrompt || input.preserveProjectedSessionOnCreateFailure) {
    markProjectedSessionPromptCreateFailed(input.pendingSessionId, input.error);
    clearLaunchIntent(input.launchIntentId);
    captureCreationFailure(
      input.error,
      input.hasPrompt
        ? "create_session_with_resolved_config"
        : "create_projected_session_materialization",
    );
    return;
  }

  const activeSessionIdBeforeRemoval = useSessionSelectionStore.getState().activeSessionId;
  useSessionIntentStore.getState().clearSession(input.pendingSessionId);
  removeSessionRecordAndClearSelection(input.pendingSessionId);
  const rolledBackShellIntent = input.rollbackOwnedShellIntent();
  if (
    rolledBackShellIntent
    && activeSessionIdBeforeRemoval === input.currentOwnedSessionId
  ) {
    if (
      input.previousActiveSessionId
      && getSessionRecord(input.previousActiveSessionId)
    ) {
      deps.activateSession(input.previousActiveSessionId);
    } else {
      const remainingIds = useSessionDirectoryStore.getState()
        .sessionIdsByWorkspaceId[input.workspaceId] ?? [];
      const fallbackSessionId = remainingIds.find(
        (id) => id !== input.pendingSessionId,
      ) ?? null;
      if (fallbackSessionId) {
        deps.activateSession(fallbackSessionId);
      } else {
        useSessionSelectionStore.getState().setActiveSessionId(null);
      }
    }
  }
  clearLaunchIntent(input.launchIntentId);
  captureCreationFailure(input.error, "create_session_with_resolved_config");
}

function clearLaunchIntent(launchIntentId: string | null | undefined): void {
  if (launchIntentId) {
    useChatLaunchIntentStore.getState().clearIfActive(launchIntentId);
  }
}

function captureCreationFailure(error: unknown, action: string): void {
  captureTelemetryException(error, {
    tags: { action, domain: "sessions" },
  });
}
