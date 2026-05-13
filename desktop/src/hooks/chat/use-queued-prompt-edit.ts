import { useCallback, useEffect, useMemo } from "react";
import type { PendingPromptEntry } from "@anyharness/sdk";
import type {
  PromptOutboxDeliveryState,
  PromptOutboxEntry,
} from "@/lib/domain/sessions/intents/session-intent-model";
import {
  useActivePendingPrompts,
  useActiveSessionId,
} from "@/hooks/chat/derived/use-active-chat-session-selectors";
import { useEditPendingPrompt } from "@/hooks/sessions/workflows/use-edit-pending-prompt";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

export interface VisiblePendingPromptEntry extends PendingPromptEntry {
  isBeingEdited: boolean;
  localOutboxDeliveryState?: PromptOutboxDeliveryState | null;
}

interface DerivedEditingState {
  activeSessionId: string | null;
  pendingPrompts: readonly PendingPromptEntry[];
  storedEditingSeq: number | null;
  editingSeq: number | null;
  isStoredSeqLive: boolean;
}

/**
 * Pure derivation of "is this edit still live": reconciles the raw stored
 * seq against the current pendingPrompts. A stale pointer (drained or
 * concurrently deleted row) naturally falls to `editingSeq = null` on the
 * next render without any sync bookkeeping.
 */
function useDerivedEditingState(): DerivedEditingState {
  const activeSessionId = useActiveSessionId();
  const pendingPrompts = useActivePendingPrompts();
  const storedEditingSeq = useChatInputStore((state) =>
    activeSessionId ? state.editingQueueSeqBySessionId[activeSessionId] ?? null : null,
  );
  const isStoredSeqLive = storedEditingSeq != null
    && pendingPrompts.some((p) => p.seq === storedEditingSeq);
  const editingSeq = isStoredSeqLive ? storedEditingSeq : null;
  return { activeSessionId, pendingPrompts, storedEditingSeq, editingSeq, isStoredSeqLive };
}

/**
 * Read-only variant for consumers that render the pending-prompt list.
 * No cleanup effect, no edit draft plumbing — just `visiblePendingPrompts`
 * (with an `isBeingEdited` flag per row) and `beginEdit`, which populates
 * the session-scoped edit draft and flips the editing seq.
 */
export function useQueuedPromptEditReader(): {
  visiblePendingPrompts: VisiblePendingPromptEntry[];
  beginEdit: (args: { seq: number; text: string }) => void;
} {
  const { activeSessionId, pendingPrompts, editingSeq } = useDerivedEditingState();
  const setEditDraft = useChatInputStore((state) => state.setEditDraft);
  const setEditingQueueSeq = useChatInputStore((state) => state.setEditingQueueSeq);

  const visiblePendingPrompts = useMemo<VisiblePendingPromptEntry[]>(
    () => pendingPrompts.map((entry) => ({
      ...entry,
      isBeingEdited: entry.seq === editingSeq,
    })),
    [pendingPrompts, editingSeq],
  );

  const beginEdit = useCallback(
    ({ seq, text }: { seq: number; text: string }) => {
      if (!activeSessionId) return;
      setEditDraft(activeSessionId, text);
      setEditingQueueSeq(activeSessionId, seq);
    },
    [activeSessionId, setEditDraft, setEditingQueueSeq],
  );

  return { visiblePendingPrompts, beginEdit };
}

export function useQueuedPromptEditStatus(): {
  isEditing: boolean;
} {
  const { editingSeq } = useDerivedEditingState();
  const isEditing = editingSeq != null;
  return useMemo(() => ({ isEditing }), [isEditing]);
}

/**
 * Full workflow variant — owns the cleanup effect for stale edits.
 * Consumed exactly once (in `ChatInput`) so the effect runs a single
 * time per store transition. PendingPromptList uses the reader variant
 * to avoid a duplicate effect subscription.
 */
export function useQueuedPromptEdit(): {
  isEditing: boolean;
  editingSeq: number | null;
  editDraft: string;
  setEditDraftText: (value: string) => void;
  cancelEdit: () => void;
  commitEdit: () => Promise<void>;
} {
  const {
    activeSessionId,
    pendingPrompts,
    storedEditingSeq,
    editingSeq,
    isStoredSeqLive,
  } = useDerivedEditingState();
  const editDraft = useChatInputStore((state) =>
    activeSessionId ? state.editDraftBySessionId[activeSessionId] ?? "" : "",
  );
  const setEditDraft = useChatInputStore((state) => state.setEditDraft);
  const setEditingQueueSeq = useChatInputStore((state) => state.setEditingQueueSeq);
  const editPendingPrompt = useEditPendingPrompt();

  const isEditing = editingSeq != null;

  // Intentional exception to the "no watch-to-set" guideline
  // (docs/frontend/guides/state.md). The trigger is SSE arrival
  // (PendingPromptRemoved), not local state that could be derived inline.
  // Mounted only in ChatInput so the effect runs once per store transition.
  useEffect(() => {
    if (!activeSessionId) return;
    if (storedEditingSeq != null && !isStoredSeqLive) {
      setEditDraft(activeSessionId, "");
      setEditingQueueSeq(activeSessionId, null);
    }
  }, [activeSessionId, isStoredSeqLive, setEditDraft, setEditingQueueSeq, storedEditingSeq]);

  const setEditDraftText = useCallback(
    (value: string) => {
      if (!activeSessionId) return;
      setEditDraft(activeSessionId, value);
    },
    [activeSessionId, setEditDraft],
  );

  const cancelEdit = useCallback(() => {
    if (!activeSessionId) return;
    setEditDraft(activeSessionId, "");
    setEditingQueueSeq(activeSessionId, null);
  }, [activeSessionId, setEditDraft, setEditingQueueSeq]);

  const commitEdit = useCallback(async () => {
    if (!activeSessionId || editingSeq == null) return;
    const trimmed = editDraft.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    const editingPrompt = pendingPrompts.find((prompt) => prompt.seq === editingSeq);
    try {
      if (isLocallyEditableOutboxPrompt(editingPrompt)) {
        patchLocalOutboxPrompt(editingPrompt.promptId, trimmed);
      } else {
        await editPendingPrompt(activeSessionId, editingSeq, trimmed);
      }
    } finally {
      setEditDraft(activeSessionId, "");
      setEditingQueueSeq(activeSessionId, null);
    }
  }, [
    activeSessionId,
    cancelEdit,
    editDraft,
    editPendingPrompt,
    editingSeq,
    pendingPrompts,
    setEditDraft,
    setEditingQueueSeq,
  ]);

  return {
    isEditing,
    editingSeq,
    editDraft,
    setEditDraftText,
    cancelEdit,
    commitEdit,
  };
}

function isLocallyEditableOutboxPrompt(
  prompt: PendingPromptEntry | undefined,
): prompt is PendingPromptEntry & {
  promptId: string;
  localOutboxDeliveryState: PromptOutboxDeliveryState;
} {
  return !!prompt
    && !!prompt.promptId
    && (prompt as PendingPromptEntry & {
      localOutboxDeliveryState?: PromptOutboxDeliveryState | null;
    }).localOutboxDeliveryState === "waiting_for_session";
}

function patchLocalOutboxPrompt(clientPromptId: string, text: string): void {
  const store = useSessionIntentStore.getState();
  const entry = store.entriesById[clientPromptId];
  if (!entry || entry.kind !== "send_prompt" || entry.deliveryState !== "waiting_for_session") {
    return;
  }

  store.patchIntent(clientPromptId, {
    text,
    blocks: updateOutboxTextBlocks(entry, text),
    contentParts: updateOutboxTextContentParts(entry, text),
  });
}

function updateOutboxTextBlocks(
  entry: PromptOutboxEntry,
  text: string,
): PromptOutboxEntry["blocks"] {
  let replaced = false;
  const blocks: PromptOutboxEntry["blocks"] = [];
  for (const block of entry.blocks) {
    if (block.type !== "text") {
      blocks.push({ ...block });
      continue;
    }
    if (replaced) {
      continue;
    }
    replaced = true;
    blocks.push({ ...block, text });
  }
  if (!replaced) {
    blocks.unshift({ type: "text", text });
  }
  return blocks;
}

function updateOutboxTextContentParts(
  entry: PromptOutboxEntry,
  text: string,
): PromptOutboxEntry["contentParts"] {
  let replaced = false;
  const contentParts: PromptOutboxEntry["contentParts"] = [];
  for (const part of entry.contentParts) {
    if (part.type !== "text") {
      contentParts.push({ ...part });
      continue;
    }
    if (replaced) {
      continue;
    }
    replaced = true;
    contentParts.push({ ...part, text });
  }
  if (!replaced) {
    contentParts.unshift({ type: "text", text });
  }
  return contentParts;
}
