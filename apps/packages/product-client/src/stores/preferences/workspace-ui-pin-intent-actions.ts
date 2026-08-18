import {
  WORKSPACE_PIN_INTENT_RECEIPT_LIMIT,
  type WorkspacePinIntentReceipt,
} from "#product/lib/domain/preferences/workspace-ui/model";
import type {
  WorkspaceUiSet,
  WorkspaceUiState,
} from "#product/stores/preferences/workspace-ui-store-types";
import {
  recordBoundedWorkspacePinLocalBarriers,
} from "#product/stores/preferences/workspace-ui-pin-local-barriers";
import {
  isSupersededByWorkspacePinHistoryObservation,
  recordBoundedWorkspacePinHistoryObservations,
} from "#product/stores/preferences/workspace-ui-pin-history-observations";

type WorkspaceUiPinIntentActions = Pick<
  WorkspaceUiState,
  "applyWorkspacePinIntentBatch"
>;

export function createWorkspaceUiPinIntentActions(
  set: WorkspaceUiSet,
): WorkspaceUiPinIntentActions {
  return {
    applyWorkspacePinIntentBatch: (intents) => {
      set((state) => {
        let pinnedWorkspaceIds = state.pinnedWorkspaceIds;
        let receiptByTarget = state.workspacePinIntentReceiptByTarget;
        let localBarrierById = state.workspacePinLocalBarrierById;
        let historyObservationById = state.workspacePinHistoryObservationById;
        let didRecord = false;
        for (const intent of intents) {
          const workspaceIds = [intent.pinId, ...intent.relatedIds];
          const isSupersededHistory = intent.provenance === "history"
            && isSupersededByWorkspacePinHistoryObservation(
              historyObservationById,
              workspaceIds,
              intent.observedAt,
            );
          if (intent.provenance === "history") {
            // A receipt may already exist after hydration. The observation is
            // still authoritative for this renderer's cross-session order.
            historyObservationById = recordBoundedWorkspacePinHistoryObservations(
              historyObservationById,
              workspaceIds,
              intent.observedAt,
            );
            didRecord = true;
          }
          const targetKey = workspacePinIntentTargetKey(
            intent.runtimeId,
            intent.sessionId,
            intent.pinId,
          );
          const previousReceipt = receiptByTarget[targetKey];
          if (
            previousReceipt
            && (
              previousReceipt.requestId === intent.requestId
              || previousReceipt.seq >= intent.seq
            )
          ) {
            continue;
          }
          const isBlocked = isSupersededHistory || isBlockedByLocalBarrier(
            intent,
            localBarrierById,
            workspaceIds,
          );
          if (!isBlocked) {
            if (intent.pinned) {
              if (!intent.relatedIds.some((id) => pinnedWorkspaceIds.includes(id))) {
                pinnedWorkspaceIds = [...pinnedWorkspaceIds, intent.pinId];
              }
            } else {
              const relatedIds = new Set(intent.relatedIds);
              pinnedWorkspaceIds = pinnedWorkspaceIds.filter((id) => !relatedIds.has(id));
            }
          }
          if (!isBlocked && intent.provenance === "live") {
            localBarrierById = recordBoundedWorkspacePinLocalBarriers(
              localBarrierById,
              workspaceIds,
              intent.observedAt,
            );
          }
          receiptByTarget = recordBoundedReceipt(receiptByTarget, targetKey, {
            requestId: intent.requestId,
            seq: intent.seq,
          });
          didRecord = true;
        }
        if (!didRecord) {
          return {};
        }
        return {
          pinnedWorkspaceIds,
          workspacePinIntentReceiptByTarget: receiptByTarget,
          workspacePinLocalBarrierById: localBarrierById,
          workspacePinHistoryObservationById: historyObservationById,
        };
      });
    },
  };
}

function isBlockedByLocalBarrier(
  intent: Parameters<WorkspaceUiState["applyWorkspacePinIntentBatch"]>[0][number],
  barriers: WorkspaceUiState["workspacePinLocalBarrierById"],
  workspaceIds: readonly string[],
): boolean {
  const targetBarriers = workspaceIds.flatMap((id) => barriers[id] ?? []);
  if (intent.provenance === "history") {
    return targetBarriers.length > 0;
  }
  return targetBarriers.some((barrier) => (
    barrier.rendererEpoch === intent.observedAt.rendererEpoch
    && barrier.sequence >= intent.observedAt.sequence
  ));
}

function workspacePinIntentTargetKey(
  runtimeId: string,
  sessionId: string,
  pinId: string,
): string {
  return JSON.stringify([runtimeId, sessionId, pinId]);
}

function recordBoundedReceipt(
  receipts: Record<string, WorkspacePinIntentReceipt>,
  targetKey: string,
  receipt: WorkspacePinIntentReceipt,
): Record<string, WorkspacePinIntentReceipt> {
  const entries = Object.entries(receipts).filter(([key]) => key !== targetKey);
  entries.push([targetKey, receipt]);
  return Object.fromEntries(entries.slice(-WORKSPACE_PIN_INTENT_RECEIPT_LIMIT));
}
