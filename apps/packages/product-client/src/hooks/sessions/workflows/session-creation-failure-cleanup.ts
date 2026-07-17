import type { ErrorContext } from "@proliferate/product-client/host/product-host";
import { isWorkspaceDirectoryMissingError } from "#product/lib/domain/sessions/creation/create-session-error";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  getSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useChatPromptRecoveryStore } from "#product/stores/chat/chat-prompt-recovery-store";
import {
  getPromptOutboxEntriesForSession,
  useSessionIntentStore,
} from "#product/stores/sessions/session-intent-store";
import {
  markProjectedSessionPromptCreateFailed,
} from "#product/hooks/sessions/workflows/session-creation-failure";
import {
  removeSessionRecordAndClearSelection,
} from "#product/hooks/sessions/workflows/session-creation-local-state";
import type {
  EmptySessionReplacementTransaction,
} from "#product/hooks/sessions/workflows/use-empty-session-replacement-cleanup";
import type {
  ReplacementShellPreferencesTransaction,
} from "#product/hooks/sessions/workflows/session-replacement-shell-preferences";

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
  /**
   * Narrow exception-capture dependency injected from the calling hook (which
   * reads the product telemetry facade). Keeps this plain workflow vendor-free.
   */
  captureException: (error: unknown, context?: ErrorContext) => void;
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
    // The replacement began empty, but the still-usable composer may have
    // queued work while it materialized. Move the complete payload into a
    // workspace-scoped recovery surface before removing the failed shell.
    moveOutboxPromptsToRecovery(input);
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
    captureCreationFailure(deps.captureException, input.error, "replace_empty_session");
    return;
  }

  // A prompt-bearing create normally keeps the failed projected shell so the
  // user can retry in place. When the workspace's checkout is gone that shell
  // is a dead end (the persistent missing-worktree panel owns the condition),
  // so move the prompt to the recovery surface and remove the shell instead.
  const discardDeadProjectedSession =
    input.hasPrompt
    && !input.preserveProjectedSessionOnCreateFailure
    && isWorkspaceDirectoryMissingError(input.error);

  if (
    (input.hasPrompt || input.preserveProjectedSessionOnCreateFailure)
    && !discardDeadProjectedSession
  ) {
    markProjectedSessionPromptCreateFailed(input.pendingSessionId, input.error);
    clearLaunchIntent(input.launchIntentId);
    captureCreationFailure(
      deps.captureException,
      input.error,
      input.hasPrompt
        ? "create_session_with_resolved_config"
        : "create_projected_session_materialization",
    );
    return;
  }

  if (discardDeadProjectedSession) {
    moveOutboxPromptsToRecovery(input);
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
  captureCreationFailure(deps.captureException, input.error, "create_session_with_resolved_config");
}

function moveOutboxPromptsToRecovery(
  input: Pick<
    SessionCreationFailureCleanupInput,
    "agentKind" | "error" | "modeId" | "modelId" | "pendingSessionId"
    | "recoveryWorkspaceUiKey" | "workspaceId"
  >,
): void {
  const acquiredPrompts = getPromptOutboxEntriesForSession(input.pendingSessionId)
    .filter((entry) => (
      entry.dispatchedAt === null
      && entry.deliveryState !== "cancelled"
      && entry.deliveryState !== "echoed_tombstone"
    ));
  if (acquiredPrompts.length === 0) {
    return;
  }
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

function clearLaunchIntent(launchIntentId: string | null | undefined): void {
  if (launchIntentId) {
    useChatLaunchIntentStore.getState().clearIfActive(launchIntentId);
  }
}

function captureCreationFailure(
  captureException: SessionCreationFailureCleanupDeps["captureException"],
  error: unknown,
  action: string,
): void {
  captureException(error, {
    tags: { action, domain: "sessions" },
  });
}
