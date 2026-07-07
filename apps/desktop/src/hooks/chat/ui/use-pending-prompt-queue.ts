import { useCallback, useMemo, useRef, useState } from "react";
import type { PendingPromptQueueRow } from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";
import { derivePendingPromptQueueRow } from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { usePromptOutboxActions } from "@/hooks/chat/workflows/use-prompt-outbox-actions";
import { useQueuedPromptEditReader } from "@/hooks/chat/ui/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "@/hooks/sessions/workflows/use-delete-pending-prompt";
import { useReorderPendingPrompts } from "@/hooks/sessions/workflows/use-reorder-pending-prompts";
import { useSteerPendingPrompt } from "@/hooks/sessions/workflows/use-steer-pending-prompt";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";

export interface PendingPromptQueueState {
  rows: PendingPromptQueueRow[];
  steeringSeq: number | null;
  sessionMaterialized: boolean;
  onBeginEdit: (seq: number) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
  onSteer: (entry: PendingPromptQueueRow) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
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
  const [steeringSeq, setSteeringSeq] = useState<number | null>(null);
  const optimisticOrderRef = useRef<string[] | null>(null);

  const rows = useMemo(() => {
    const derived = visiblePendingPrompts.map(derivePendingPromptQueueRow);
    // Apply optimistic reorder if active (between user drag and server ack).
    if (optimisticOrderRef.current) {
      const keyMap = new Map(derived.map((row) => [row.key, row]));
      const reordered: PendingPromptQueueRow[] = [];
      for (const key of optimisticOrderRef.current) {
        const row = keyMap.get(key);
        if (row) {
          reordered.push(row);
        }
      }
      // Include any rows not in the optimistic order (new arrivals).
      for (const row of derived) {
        if (!optimisticOrderRef.current.includes(row.key)) {
          reordered.push(row);
        }
      }
      // If server has reconciled (lengths match, keys stable), clear optimistic.
      if (reordered.length === derived.length) {
        return reordered;
      }
      optimisticOrderRef.current = null;
    }
    return derived;
  }, [visiblePendingPrompts]);

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
      if (!activeSessionId || entry.deleteAction !== "runtime") return;
      void deletePendingPrompt(activeSessionId, entry.seq);
    },
    [activeSessionId, cancelBeforeDispatch, deletePendingPrompt, dismissPrompt],
  );

  const handleBeginEdit = useCallback(
    (seq: number) => {
      const entry = visiblePendingPrompts.find((candidate) => candidate.seq === seq);
      if (!entry) return;
      beginEdit({ seq: entry.seq, text: entry.text });
    },
    [beginEdit, visiblePendingPrompts],
  );

  const handleSteer = useCallback(
    (entry: PendingPromptQueueRow) => {
      if (!activeSessionId || !sessionMaterialized || entry.seq <= 0) return;
      setSteeringSeq(entry.seq);
      steerPendingPrompt(activeSessionId, entry.seq)
        .catch(() => {
          // Errors are surfaced via the mutation's onError or silently absorbed
          // when the session is not yet materialized (graceful no-op).
        })
        .finally(() => {
          setSteeringSeq(null);
        });
    },
    [activeSessionId, sessionMaterialized, steerPendingPrompt],
  );

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!activeSessionId || !sessionMaterialized || fromIndex === toIndex) return;
      const currentRows = [...rows];
      const [moved] = currentRows.splice(fromIndex, 1);
      currentRows.splice(toIndex, 0, moved);
      // Only runtime-confirmed rows (seq > 0) can be reordered server-side.
      const runtimeSeqs = currentRows
        .filter((row) => row.seq > 0)
        .map((row) => row.seq);
      if (runtimeSeqs.length === 0) return;
      // Apply optimistic order immediately.
      optimisticOrderRef.current = currentRows.map((row) => row.key);
      reorderPendingPrompts(activeSessionId, runtimeSeqs).catch(() => {
        optimisticOrderRef.current = null;
      });
    },
    [activeSessionId, sessionMaterialized, reorderPendingPrompts, rows],
  );

  return {
    rows,
    steeringSeq,
    sessionMaterialized,
    onBeginEdit: handleBeginEdit,
    onDelete: handleDelete,
    onSteer: handleSteer,
    onReorder: handleReorder,
  };
}
