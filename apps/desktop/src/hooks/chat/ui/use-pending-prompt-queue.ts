import { useCallback, useMemo, useRef, useState } from "react";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueRow,
} from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { usePromptOutboxActions } from "@/hooks/chat/workflows/use-prompt-outbox-actions";
import { useQueuedPromptEditReader } from "@/hooks/chat/ui/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "@/hooks/sessions/workflows/use-delete-pending-prompt";
import { useReorderPendingPrompts } from "@/hooks/sessions/workflows/use-reorder-pending-prompts";
import { useSteerPendingPrompt } from "@/hooks/sessions/workflows/use-steer-pending-prompt";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useToastStore } from "@/stores/toast/toast-store";

export interface PendingPromptQueueState {
  rows: PendingPromptQueueRow[];
  steeringSeq: number | null;
  sessionMaterialized: boolean;
  queueMutationInFlight: boolean;
  onBeginEdit: (entry: PendingPromptQueueRow) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
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
  const showToast = useToastStore((state) => state.show);
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
          showToast(`Failed to send queued message next: ${errorMessage(error)}`);
        })
        .finally(() => {
          if (mutationsBySessionIdRef.current.get(sessionId)?.token === token) {
            mutationsBySessionIdRef.current.delete(sessionId);
            setMutationRevision((revision) => revision + 1);
          }
        });
    },
    [activeSessionId, sessionMaterialized, showToast, steerPendingPrompt],
  );

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        !activeSessionId
        || !sessionMaterialized
        || mutationsBySessionIdRef.current.has(activeSessionId)
        || fromIndex === toIndex
        || fromIndex < 0
        || toIndex < 0
        || fromIndex >= rows.length
        || toIndex >= rows.length
      ) {
        return;
      }
      const expectedSeqs = rows.filter((row) => row.seq > 0).map((row) => row.seq);
      const reorderedRows = [...rows];
      const [moved] = reorderedRows.splice(fromIndex, 1);
      if (!moved) {
        return;
      }
      reorderedRows.splice(toIndex, 0, moved);
      const desiredSeqs = reorderedRows
        .filter((row) => row.seq > 0)
        .map((row) => row.seq);
      if (desiredSeqs.length === 0 || arraysEqual(expectedSeqs, desiredSeqs)) {
        return;
      }

      const sessionId = activeSessionId;
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
          showToast(`Failed to reorder queued messages: ${errorMessage(error)}`);
        })
        .finally(() => {
          if (mutationsBySessionIdRef.current.get(sessionId)?.token === token) {
            mutationsBySessionIdRef.current.delete(sessionId);
            setMutationRevision((revision) => revision + 1);
          }
        });
    },
    [activeSessionId, reorderPendingPrompts, rows, sessionMaterialized, showToast],
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
