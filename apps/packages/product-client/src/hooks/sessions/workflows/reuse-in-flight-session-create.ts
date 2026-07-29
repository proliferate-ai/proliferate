import { annotateLatencyFlow, cancelLatencyFlow } from "#product/lib/infra/measurement/measurement-port";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { inFlightSessionCreatesByWorkspace } from "#product/hooks/sessions/workflows/session-creation-in-flight";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";

export interface ReuseInFlightSessionCreateInput {
  workspaceId: string;
  agentKind: string;
  modelId: string;
  latencyFlowId?: string | null;
  previousActiveSessionId: string | null;
}

/**
 * Joins an empty-session create that is already in flight for the same
 * workspace, agent and model, instead of opening a second identical chat.
 *
 * Returns `{ reused: false }` when there is nothing to join, so the caller
 * falls through to its normal creation path. On failure the shell intent and
 * the active session are put back the way they were before rethrowing — the
 * user pressed a button that opened nothing, so nothing should have moved.
 */
export async function reuseInFlightSessionCreate(
  input: ReuseInFlightSessionCreateInput,
  deps: { activateSession: (sessionId: string) => void },
): Promise<{ reused: true; clientSessionId: string } | { reused: false }> {
  const inFlightCreate = inFlightSessionCreatesByWorkspace.get(input.workspaceId) ?? null;
  if (
    !inFlightCreate
    || inFlightCreate.agentKind !== input.agentKind
    || inFlightCreate.modelId !== input.modelId
  ) {
    return { reused: false };
  }

  annotateLatencyFlow(input.latencyFlowId, {
    targetWorkspaceId: input.workspaceId,
    targetSessionId: inFlightCreate.sessionId,
  });
  const pendingShellWrite = writeChatShellIntentForSession({
    workspaceId: input.workspaceId,
    sessionId: inFlightCreate.sessionId,
  });
  if (getSessionRecord(inFlightCreate.sessionId)) {
    deps.activateSession(inFlightCreate.sessionId);
  }
  cancelLatencyFlow(input.latencyFlowId, "session_create_reused_inflight", {
    reusedSessionId: inFlightCreate.sessionId,
  });

  try {
    const resolvedClientSessionId = await inFlightCreate.promise;
    if (pendingShellWrite && getSessionRecord(resolvedClientSessionId)) {
      deps.activateSession(resolvedClientSessionId);
    }
    return { reused: true, clientSessionId: resolvedClientSessionId };
  } catch (error) {
    let rolledBackShellIntent = false;
    if (pendingShellWrite) {
      rolledBackShellIntent = useWorkspaceUiStore.getState().rollbackShellIntent({
        workspaceId: pendingShellWrite.shellWorkspaceId,
        expectedIntent: pendingShellWrite.currentIntent,
        expectedEpoch: pendingShellWrite.epoch,
        rollbackIntent: pendingShellWrite.previousIntent,
      }).rolledBack;
    }
    if (
      rolledBackShellIntent
      && useSessionSelectionStore.getState().activeSessionId === inFlightCreate.sessionId
    ) {
      if (input.previousActiveSessionId) {
        deps.activateSession(input.previousActiveSessionId);
      } else {
        useSessionSelectionStore.getState().setActiveSessionId(null);
      }
    }
    throw error;
  }
}
