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
  reorderInFlight: boolean;
  onBeginEdit: (entry: PendingPromptQueueRow) => void;
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
  const [reorderInFlight, setReorderInFlight] = useState(false);
  const optimisticOrderRef = useRef<string[] | null>(null);

  const rows = useMemo(() => {
    const derived = visiblePendingPrompts.map(derivePendingPromptQueueRow);
    const order = optimisticOrderRef.current;
    // Apply the optimistic order only while the reorder round-trip is in
    // flight. The ref is cleared when the mutation settles (see handleReorder),
    // after which we always fall back to the server-driven order — so later
    // server reorders (e.g. Steer promotions) are no longer overridden by a
    // stale drag-time order. `reorderInFlight` is included in the deps so the
    // clear re-renders this memo back to the reconciled order.
    if (!order) return derived;
    const keyMap = new Map(derived.map((row) => [row.key, row]));
    const reordered: PendingPromptQueueRow[] = [];
    for (const key of order) {
      const row = keyMap.get(key);
      if (row) {
        reordered.push(row);
      }
    }
    // Include any rows not in the optimistic order (new arrivals).
    for (const row of derived) {
      if (!order.includes(row.key)) {
        reordered.push(row);
      }
    }
    return reordered;
  }, [visiblePendingPrompts, reorderInFlight]);

  // Resolve the current runtime seq for a row from its stable promptId against
  // the latest pendingPrompts — never the row snapshot. A reorder renumbers the
  // same seq set into a permutation, so a seq captured at render time can point
  // at the wrong prompt by action time. Returns null when the promptId is gone
  // (just executed/deleted) so the caller no-ops.
  const resolveLiveSeq = useCallback(
    (entry: PendingPromptQueueRow): number | null => {
      if (!entry.promptId) {
        return entry.seq > 0 ? entry.seq : null;
      }
      const live = visiblePendingPrompts.find((p) => p.promptId === entry.promptId);
      return live ? live.seq : null;
    },
    [visiblePendingPrompts],
  );

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
      const seq = resolveLiveSeq(entry);
      if (seq == null || seq <= 0) return;
      void deletePendingPrompt(activeSessionId, seq);
    },
    [activeSessionId, cancelBeforeDispatch, deletePendingPrompt, dismissPrompt, resolveLiveSeq],
  );

  const handleBeginEdit = useCallback(
    (entry: PendingPromptQueueRow) => {
      if (!entry.promptId) return;
      const live = visiblePendingPrompts.find((p) => p.promptId === entry.promptId);
      if (!live) return;
      beginEdit({ promptId: live.promptId ?? null, text: live.text });
    },
    [beginEdit, visiblePendingPrompts],
  );

  const handleSteer = useCallback(
    (entry: PendingPromptQueueRow) => {
      if (!activeSessionId || !sessionMaterialized) return;
      const seq = resolveLiveSeq(entry);
      if (seq == null || seq <= 0) return;
      setSteeringSeq(seq);
      steerPendingPrompt(activeSessionId, seq)
        .catch(() => {
          // Errors are surfaced via the mutation's onError or silently absorbed
          // when the session is not yet materialized (graceful no-op).
        })
        .finally(() => {
          setSteeringSeq(null);
        });
    },
    [activeSessionId, sessionMaterialized, resolveLiveSeq, steerPendingPrompt],
  );

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!activeSessionId || !sessionMaterialized || fromIndex === toIndex) return;
      const currentRows = [...rows];
      const [moved] = currentRows.splice(fromIndex, 1);
      if (!moved) return;
      currentRows.splice(toIndex, 0, moved);
      // Only runtime-confirmed rows (seq > 0) can be reordered server-side.
      const runtimeSeqs = currentRows
        .filter((row) => row.seq > 0)
        .map((row) => row.seq);
      if (runtimeSeqs.length === 0) return;
      // Apply optimistic order immediately, and clear it once the round-trip
      // settles (success or failure) so the server order takes over.
      optimisticOrderRef.current = currentRows.map((row) => row.key);
      setReorderInFlight(true);
      reorderPendingPrompts(activeSessionId, runtimeSeqs)
        .then(() => {
          optimisticOrderRef.current = null;
        })
        .catch(() => {
          optimisticOrderRef.current = null;
        })
        .finally(() => {
          setReorderInFlight(false);
        });
    },
    [activeSessionId, sessionMaterialized, reorderPendingPrompts, rows],
  );

  return {
    rows,
    steeringSeq,
    sessionMaterialized,
    reorderInFlight,
    onBeginEdit: handleBeginEdit,
    onDelete: handleDelete,
    onSteer: handleSteer,
    onReorder: handleReorder,
  };
}
