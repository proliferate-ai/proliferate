import {
  WORKSPACE_PIN_INTENT_RECEIPT_LIMIT,
  type WorkspacePinIntentReceipt,
} from "#product/lib/domain/preferences/workspace-ui/model";
import type { ResolvedWorkspacePinIntent } from "#product/lib/domain/workspaces/sidebar/workspace-pin-intents";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

export function applyWorkspacePinIntentBatch(
  intents: readonly ResolvedWorkspacePinIntent[],
): void {
  useWorkspaceUiStore.setState((state) => {
    let pinnedWorkspaceIds = state.pinnedWorkspaceIds;
    let receiptByTarget = state.workspacePinIntentReceiptByTarget;
    let didApply = false;
    for (const intent of [...intents].sort((left, right) => left.seq - right.seq)) {
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
      if (intent.pinned) {
        if (!intent.relatedIds.some((id) => pinnedWorkspaceIds.includes(id))) {
          pinnedWorkspaceIds = [...pinnedWorkspaceIds, intent.pinId];
        }
      } else {
        const relatedIds = new Set(intent.relatedIds);
        pinnedWorkspaceIds = pinnedWorkspaceIds.filter((id) => !relatedIds.has(id));
      }
      receiptByTarget = recordBoundedReceipt(receiptByTarget, targetKey, {
        requestId: intent.requestId,
        seq: intent.seq,
      });
      didApply = true;
    }
    if (!didApply) {
      return {};
    }
    return {
      pinnedWorkspaceIds,
      workspacePinIntentReceiptByTarget: receiptByTarget,
    };
  });
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
