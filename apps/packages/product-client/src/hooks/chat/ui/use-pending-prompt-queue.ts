import { useCallback, useMemo, useRef, useState } from "react";
import {
  derivePendingPromptQueueRow,
  reorderHumanPendingPromptRows,
  type PendingPromptQueueRow,
} from "#product/domain/chats/pending-prompts/pending-prompt-queue";
import { useActiveSessionId } from "#product/hooks/chat/derived/use-active-session-identity";
import { usePromptOutboxActions } from "#product/hooks/chat/workflows/use-prompt-outbox-actions";
import { useQueuedPromptEditReader } from "#product/hooks/chat/ui/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "#product/hooks/sessions/workflows/use-delete-pending-prompt";
import { useReorderPendingPrompts } from "#product/hooks/sessions/workflows/use-reorder-pending-prompts";
import { useSteerPendingPrompt } from "#product/hooks/sessions/workflows/use-steer-pending-prompt";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useToastStore } from "#product/stores/toast/toast-store";

export interface PendingPromptQueueState {
  rows: PendingPromptQueueRow[];
  steeringSeq: number | null;
  sessionMaterialized: boolean;
  queueMutationInFlight: boolean;
  onBeginEdit: (entry: PendingPromptQueueRow) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  /** Addressed by row key, never by rendered position — see `reorderHumanPendingPromptRows`. */
  onReorder: (fromKey: string, toKey: string) => void;
}

interface PendingQueueMutation {
  token: symbol;
  kind: "steer" | "reorder";
  steeringSeq: number | null;
  optimisticOrder: string[] | null;
}

export function usePendingPromptQueue(): PendingPromptQueueState {
  const activeSessionId = useActiveSessionId();
  const sessionMaterialized = useSessionDirectoryStore((state) =>
    activeSessionId
      ? Boolean(state.entriesById[activeSessionId]?.materializedSessionId)
      : false,
  );
  const { visiblePendingPrompts, beginEdit } = useQueuedPromptEditReader();
  const deletePendingPrompt = useDeletePendingPrompt();
  const reorderPendingPrompts = useReorderPendingPrompts();
  const steerPendingPrompt = useSteerPendingPrompt();
  const { cancelBeforeDispatch, dismissPrompt } = usePromptOutboxActions();
  const showErrorToast = useToastStore((state) => state.showError);
  const mutationsBySessionIdRef = useRef(new Map<string, PendingQueueMutation>());
  const [, setMutationRevision] = useState(0);
  const activeMutation = activeSessionId
    ? mutationsBySessionIdRef.current.get(activeSessionId) ?? null
    : null;

  const rows = useMemo(() => {
    const derived = visiblePendingPrompts.map(derivePendingPromptQueueRow);
    const order = activeMutation?.optimisticOrder ?? null;
    if (!order) {
      return derived;
    }
    const byKey = new Map(derived.map((row) => [row.key, row]));
    const reordered = order.flatMap((key) => {
      const row = byKey.get(key);
      return row ? [row] : [];
    });
    const optimisticKeys = new Set(order);
    reordered.push(...derived.filter((row) => !optimisticKeys.has(row.key)));
    return reordered;
  }, [activeMutation, visiblePendingPrompts]);

  const handleDelete = useCallback(
    (entry: PendingPromptQueueRow) => {
      if (entry.deleteAction === "cancel_local" && entry.promptId) {
        cancelBeforeDispatch(entry.promptId);
        return;
      }
      if (entry.deleteAction === "dismiss_local" && entry.promptId) {
        dismissPrompt(entry.promptId);
        return;
      }
      if (!activeSessionId || entry.deleteAction !== "runtime") {
        return;
      }
      if (entry.seq > 0) {
        deletePendingPrompt(activeSessionId, entry.seq);
      }
    },
    [activeSessionId, cancelBeforeDispatch, deletePendingPrompt, dismissPrompt],
  );

  const handleBeginEdit = useCallback(
    (entry: PendingPromptQueueRow) => {
      const live = visiblePendingPrompts.find((prompt) => prompt.seq === entry.seq);
      if (live) {
        beginEdit({ seq: live.seq, text: live.text });
      }
    },
    [beginEdit, visiblePendingPrompts],
  );

  const handleSteer = useCallback(
    (entry: PendingPromptQueueRow) => {
      if (
        !activeSessionId
        || !sessionMaterialized
        || entry.seq <= 0
        || mutationsBySessionIdRef.current.has(activeSessionId)
      ) {
        return;
      }
      const sessionId = activeSessionId;
      // Named and self-referential so the error toast's Retry re-runs the same
      // attempt. Without it the toast would report the failure and leave the
      // message queued where it was, which is the state the user was trying to
      // change — a report with no way back to the action.
      const attemptSteer = () => {
        const token = Symbol("steer-pending-prompt");
        mutationsBySessionIdRef.current.set(sessionId, {
          token,
          kind: "steer",
          steeringSeq: entry.seq,
          optimisticOrder: null,
        });
        setMutationRevision((revision) => revision + 1);
        void steerPendingPrompt(sessionId, entry.seq)
          .catch((error: unknown) => {
            showErrorToast({
              headline: "Message not sent next",
              consequence: "It is still queued in its original position.",
              cause: errorMessage(error),
              retry: attemptSteer,
            });
          })
          .finally(() => {
            if (mutationsBySessionIdRef.current.get(sessionId)?.token === token) {
              mutationsBySessionIdRef.current.delete(sessionId);
              setMutationRevision((revision) => revision + 1);
            }
          });
      };
      attemptSteer();
    },
    [activeSessionId, sessionMaterialized, showErrorToast, steerPendingPrompt],
  );

  const handleReorder = useCallback(
    (fromKey: string, toKey: string) => {
      if (
        !activeSessionId
        || !sessionMaterialized
        || mutationsBySessionIdRef.current.has(activeSessionId)
      ) {
        return;
      }
      const expectedSeqs = rows.filter((row) => row.seq > 0).map((row) => row.seq);
      const reorderedRows = reorderHumanPendingPromptRows(rows, fromKey, toKey);
      if (!reorderedRows) {
        return;
      }
      const desiredSeqs = reorderedRows
        .filter((row) => row.seq > 0)
        .map((row) => row.seq);
      if (desiredSeqs.length === 0 || arraysEqual(expectedSeqs, desiredSeqs)) {
        return;
      }

      const sessionId = activeSessionId;
      const attemptReorder = () => {
        const token = Symbol("reorder-pending-prompts");
        mutationsBySessionIdRef.current.set(sessionId, {
          token,
          kind: "reorder",
          steeringSeq: null,
          optimisticOrder: reorderedRows.map((row) => row.key),
        });
        setMutationRevision((revision) => revision + 1);
        void reorderPendingPrompts(sessionId, expectedSeqs, desiredSeqs)
          .catch((error: unknown) => {
            showErrorToast({
              headline: "Queue order not changed",
              consequence: "The queue is still in its previous order.",
              cause: errorMessage(error),
              retry: attemptReorder,
            });
          })
          .finally(() => {
            if (mutationsBySessionIdRef.current.get(sessionId)?.token === token) {
              mutationsBySessionIdRef.current.delete(sessionId);
              setMutationRevision((revision) => revision + 1);
            }
          });
      };
      attemptReorder();
    },
    [activeSessionId, reorderPendingPrompts, rows, sessionMaterialized, showErrorToast],
  );

  const queueMutationInFlight = activeMutation !== null;

  return {
    rows,
    steeringSeq: activeMutation?.kind === "steer" ? activeMutation.steeringSeq : null,
    sessionMaterialized,
    queueMutationInFlight,
    onBeginEdit: handleBeginEdit,
    onDelete: handleDelete,
    onSteer: handleSteer,
    onReorder: handleReorder,
  };
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
