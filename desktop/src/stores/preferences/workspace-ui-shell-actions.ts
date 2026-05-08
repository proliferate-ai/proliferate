import { sameStringArray } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import type { WorkspaceUiState } from "@/stores/preferences/workspace-ui-store";

type WorkspaceUiSet = (
  partial:
    | Partial<WorkspaceUiState>
    | WorkspaceUiState
    | ((state: WorkspaceUiState) => Partial<WorkspaceUiState> | WorkspaceUiState),
) => void;
type WorkspaceUiGet = () => WorkspaceUiState;

type WorkspaceUiShellActions = Pick<
  WorkspaceUiState,
  | "setActiveShellTabKeyForWorkspace"
  | "setShellTabOrderForWorkspace"
  | "writeShellIntent"
  | "replaceShellIntent"
  | "rollbackShellIntent"
  | "setPendingChatActivation"
  | "clearPendingChatActivation"
  | "resetWorkspaceShellTabs"
>;

export function createWorkspaceUiShellActions(
  set: WorkspaceUiSet,
  get: WorkspaceUiGet,
): WorkspaceUiShellActions {
  return {
    setActiveShellTabKeyForWorkspace: (workspaceId, key) => {
      get().writeShellIntent({ workspaceId, intent: key });
    },

    setShellTabOrderForWorkspace: (workspaceId, order) => {
      const hasCurrent = Object.prototype.hasOwnProperty.call(
        get().shellTabOrderByWorkspace,
        workspaceId,
      );
      const current = hasCurrent ? get().shellTabOrderByWorkspace[workspaceId] : [];
      if (hasCurrent && sameStringArray(current, order)) {
        return;
      }
      set({
        shellTabOrderByWorkspace: {
          ...get().shellTabOrderByWorkspace,
          [workspaceId]: order,
        },
      });
    },

    writeShellIntent: ({ workspaceId, intent }) => {
      const hasCurrent = Object.prototype.hasOwnProperty.call(
        get().activeShellTabKeyByWorkspace,
        workspaceId,
      );
      const current = hasCurrent ? get().activeShellTabKeyByWorkspace[workspaceId] : null;
      const previousEpoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
      if (hasCurrent && current === intent) {
        return {
          changed: false,
          previousIntent: current,
          currentIntent: current,
          epoch: previousEpoch,
        };
      }
      const nextEpoch = previousEpoch + 1;
      set({
        activeShellTabKeyByWorkspace: {
          ...get().activeShellTabKeyByWorkspace,
          [workspaceId]: intent,
        },
        shellActivationEpochByWorkspace: {
          ...get().shellActivationEpochByWorkspace,
          [workspaceId]: nextEpoch,
        },
      });
      return {
        changed: true,
        previousIntent: current,
        currentIntent: intent,
        epoch: nextEpoch,
      };
    },

    replaceShellIntent: ({ workspaceId, expectedIntent, nextIntent, expectedEpoch }) => {
      const previousIntent = get().activeShellTabKeyByWorkspace[workspaceId] ?? null;
      const previousEpoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
      if (
        previousIntent !== expectedIntent
        || (expectedEpoch !== undefined && previousEpoch !== expectedEpoch)
      ) {
        return {
          changed: false,
          replaced: false,
          previousIntent,
          currentIntent: previousIntent,
          epoch: previousEpoch,
        };
      }
      const result = get().writeShellIntent({ workspaceId, intent: nextIntent });
      return { ...result, replaced: result.changed };
    },

    rollbackShellIntent: ({
      workspaceId,
      expectedIntent,
      expectedEpoch,
      expectedPendingAttemptId,
      rollbackIntent,
    }) => {
      const previousIntent = get().activeShellTabKeyByWorkspace[workspaceId] ?? null;
      const previousEpoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
      const pending = get().pendingChatActivationByWorkspace[workspaceId] ?? null;
      if (
        previousIntent !== expectedIntent
        || previousEpoch !== expectedEpoch
        || (
          expectedPendingAttemptId !== undefined
          && pending?.attemptId !== expectedPendingAttemptId
        )
      ) {
        return {
          changed: false,
          rolledBack: false,
          previousIntent,
          currentIntent: previousIntent,
          epoch: previousEpoch,
        };
      }
      const result = get().writeShellIntent({ workspaceId, intent: rollbackIntent });
      return { ...result, rolledBack: result.changed };
    },

    setPendingChatActivation: ({ workspaceId, pending }) => {
      set({
        pendingChatActivationByWorkspace: {
          ...get().pendingChatActivationByWorkspace,
          [workspaceId]: pending,
        },
      });
      return { set: true };
    },

    clearPendingChatActivation: ({ workspaceId, attemptId, bumpIfCurrent }) => {
      const pending = get().pendingChatActivationByWorkspace[workspaceId] ?? null;
      const epoch = get().shellActivationEpochByWorkspace[workspaceId] ?? 0;
      if (!pending || pending.attemptId !== attemptId) {
        return { cleared: false, bumped: false, epoch };
      }
      const nextEpoch = bumpIfCurrent ? epoch + 1 : epoch;
      set({
        pendingChatActivationByWorkspace: {
          ...get().pendingChatActivationByWorkspace,
          [workspaceId]: null,
        },
        shellActivationEpochByWorkspace: bumpIfCurrent
          ? {
            ...get().shellActivationEpochByWorkspace,
            [workspaceId]: nextEpoch,
          }
          : get().shellActivationEpochByWorkspace,
      });
      return { cleared: true, bumped: bumpIfCurrent, epoch: nextEpoch };
    },

    resetWorkspaceShellTabs: (workspaceId) => {
      const active = { ...get().activeShellTabKeyByWorkspace };
      const order = { ...get().shellTabOrderByWorkspace };
      const epoch = { ...get().shellActivationEpochByWorkspace };
      const pending = { ...get().pendingChatActivationByWorkspace };
      delete active[workspaceId];
      delete order[workspaceId];
      delete epoch[workspaceId];
      delete pending[workspaceId];
      set({
        activeShellTabKeyByWorkspace: active,
        shellTabOrderByWorkspace: order,
        shellActivationEpochByWorkspace: epoch,
        pendingChatActivationByWorkspace: pending,
      });
    },
  };
}
