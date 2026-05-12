import { sameStringArray } from "@/lib/domain/workspaces/selection/workspace-keyed-preferences";
import { recordDebugActionDiagnostic } from "@/lib/infra/measurement/debug-action-diagnostic";
import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

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
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "set_active_shell_tab_key",
        keys: [workspaceId, key ?? "null"],
        detail: { workspaceId, key },
      });
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
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "set_shell_tab_order",
        keys: [workspaceId],
        detail: {
          workspaceId,
          count: order.length,
          previousCount: current.length,
        },
      });
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
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "write_shell_intent_skipped",
          keys: [workspaceId, intent ?? "null"],
          detail: {
            workspaceId,
            intent,
            previousEpoch,
          },
        });
        return {
          changed: false,
          previousIntent: current,
          currentIntent: current,
          epoch: previousEpoch,
        };
      }
      const nextEpoch = previousEpoch + 1;
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "write_shell_intent",
        keys: [workspaceId, intent ?? "null"],
        detail: {
          workspaceId,
          previousIntent: current,
          intent,
          previousEpoch,
          nextEpoch,
        },
      });
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
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "replace_shell_intent_rejected",
          keys: [workspaceId, nextIntent ?? "null"],
          detail: {
            workspaceId,
            expectedIntent,
            nextIntent,
            expectedEpoch,
            previousIntent,
            previousEpoch,
          },
        });
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
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "rollback_shell_intent_rejected",
          keys: [workspaceId, rollbackIntent ?? "null"],
          detail: {
            workspaceId,
            expectedIntent,
            expectedEpoch,
            expectedPendingAttemptId,
            previousIntent,
            previousEpoch,
            pendingAttemptId: pending?.attemptId ?? null,
            rollbackIntent,
          },
        });
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
      const current = get().pendingChatActivationByWorkspace[workspaceId] ?? null;
      if (
        current?.attemptId === pending.attemptId
        && current.sessionId === pending.sessionId
        && current.intent === pending.intent
        && current.guardToken === pending.guardToken
        && current.workspaceSelectionNonce === pending.workspaceSelectionNonce
        && current.shellEpochAtWrite === pending.shellEpochAtWrite
        && current.sessionActivationEpochAtWrite === pending.sessionActivationEpochAtWrite
      ) {
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "set_pending_chat_activation_skipped",
          keys: [workspaceId, pending.sessionId],
          detail: {
            workspaceId,
            sessionId: pending.sessionId,
            attemptId: pending.attemptId,
            intent: pending.intent,
          },
        });
        return { set: false };
      }
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "set_pending_chat_activation",
        keys: [workspaceId, pending.sessionId],
        detail: {
          workspaceId,
          sessionId: pending.sessionId,
          attemptId: pending.attemptId,
          previousAttemptId: current?.attemptId ?? null,
          intent: pending.intent,
          shellEpochAtWrite: pending.shellEpochAtWrite,
          guardToken: pending.guardToken,
        },
      });
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
        recordDebugActionDiagnostic({
          category: "workspace_ui_store.action",
          label: "clear_pending_chat_activation_skipped",
          keys: [workspaceId],
          detail: {
            workspaceId,
            attemptId,
            currentAttemptId: pending?.attemptId ?? null,
            bumpIfCurrent,
            epoch,
          },
        });
        return { cleared: false, bumped: false, epoch };
      }
      const nextEpoch = bumpIfCurrent ? epoch + 1 : epoch;
      recordDebugActionDiagnostic({
        category: "workspace_ui_store.action",
        label: "clear_pending_chat_activation",
        keys: [workspaceId, pending.sessionId],
        detail: {
          workspaceId,
          sessionId: pending.sessionId,
          attemptId,
          bumpIfCurrent,
          epoch,
          nextEpoch,
        },
      });
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
