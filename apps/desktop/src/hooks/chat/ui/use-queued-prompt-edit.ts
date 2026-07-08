import { useCallback, useEffect, useMemo } from "react";
import type { PendingPromptEntry } from "@anyharness/sdk";
import type {
  PromptOutboxDeliveryState,
  PromptOutboxEntry,
} from "@proliferate/product-domain/sessions/intents/session-intent-model";
import {
  useActivePendingPrompts,
} from "@/hooks/chat/derived/use-active-pending-session-interactions";
import {
  useActiveSessionId,
} from "@/hooks/chat/derived/use-active-session-identity";
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
  storedEditingPromptId: string | null;
  editingPromptId: string | null;
  editingPrompt: PendingPromptEntry | null;
  isStoredPromptLive: boolean;
}

/**
 * Pure derivation of "is this edit still live": reconciles the raw stored
 * promptId against the current pendingPrompts. Tracking by the stable
 * promptId (rather than the volatile runtime seq) means a server reorder
 * renumber can no longer silently retarget an in-flight edit. A stale
 * pointer (drained, concurrently deleted, or just executed row) naturally
 * falls to `editingPromptId = null` on the next render without any sync
 * bookkeeping.
 */
function useDerivedEditingState(): DerivedEditingState {
  const activeSessionId = useActiveSessionId();
  const pendingPrompts = useActivePendingPrompts();
  const storedEditingPromptId = useChatInputStore((state) =>
    activeSessionId ? state.editingQueuePromptIdBySessionId[activeSessionId] ?? null : null,
  );
  const editingPrompt = storedEditingPromptId != null
    ? pendingPrompts.find((p) => p.promptId === storedEditingPromptId) ?? null
    : null;
  const isStoredPromptLive = editingPrompt != null;
  const editingPromptId = isStoredPromptLive ? storedEditingPromptId : null;
  return {
    activeSessionId,
    pendingPrompts,
    storedEditingPromptId,
    editingPromptId,
    editingPrompt,
    isStoredPromptLive,
  };
}

/**
 * Read-only variant for consumers that render the pending-prompt list.
 * No cleanup effect, no edit draft plumbing — just `visiblePendingPrompts`
 * (with an `isBeingEdited` flag per row) and `beginEdit`, which populates
 * the session-scoped edit draft and flips the editing seq.
 */
export function useQueuedPromptEditReader(): {
  visiblePendingPrompts: VisiblePendingPromptEntry[];
  beginEdit: (args: { promptId: string | null; text: string }) => void;
} {
  const { activeSessionId, pendingPrompts, editingPromptId } = useDerivedEditingState();
  const setEditDraft = useChatInputStore((state) => state.setEditDraft);
  const setEditingQueuePromptId = useChatInputStore((state) => state.setEditingQueuePromptId);

  const visiblePendingPrompts = useMemo<VisiblePendingPromptEntry[]>(
    () => pendingPrompts.map((entry) => ({
      ...entry,
      isBeingEdited: entry.promptId != null && entry.promptId === editingPromptId,
    })),
    [pendingPrompts, editingPromptId],
  );

  const beginEdit = useCallback(
    ({ promptId, text }: { promptId: string | null; text: string }) => {
      // The edit pointer is keyed on the stable promptId; a prompt without one
      // cannot be safely re-targeted across a reorder renumber, so ignore it.
      if (!activeSessionId || !promptId) return;
      setEditDraft(activeSessionId, text);
      setEditingQueuePromptId(activeSessionId, promptId);
    },
    [activeSessionId, setEditDraft, setEditingQueuePromptId],
  );

  return { visiblePendingPrompts, beginEdit };
}

export function useQueuedPromptEditStatus(): {
  isEditing: boolean;
} {
  const { editingPromptId } = useDerivedEditingState();
  const isEditing = editingPromptId != null;
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
  editDraft: string;
  setEditDraftText: (value: string) => void;
  cancelEdit: () => void;
  commitEdit: () => Promise<void>;
} {
  const {
    activeSessionId,
    pendingPrompts,
    storedEditingPromptId,
    editingPromptId,
    isStoredPromptLive,
  } = useDerivedEditingState();
  const editDraft = useChatInputStore((state) =>
    activeSessionId ? state.editDraftBySessionId[activeSessionId] ?? "" : "",
  );
  const setEditDraft = useChatInputStore((state) => state.setEditDraft);
  const setEditingQueuePromptId = useChatInputStore((state) => state.setEditingQueuePromptId);
  const editPendingPrompt = useEditPendingPrompt();

  const isEditing = editingPromptId != null;

  // Intentional exception to the "no watch-to-set" guideline
  // (specs/codebase/structures/frontend/guides/state.md). The trigger is SSE arrival
  // (PendingPromptRemoved), not local state that could be derived inline.
  // Mounted only in ChatInput so the effect runs once per store transition.
  useEffect(() => {
    if (!activeSessionId) return;
    if (storedEditingPromptId != null && !isStoredPromptLive) {
      setEditDraft(activeSessionId, "");
      setEditingQueuePromptId(activeSessionId, null);
    }
  }, [activeSessionId, isStoredPromptLive, setEditDraft, setEditingQueuePromptId, storedEditingPromptId]);

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
    setEditingQueuePromptId(activeSessionId, null);
  }, [activeSessionId, setEditDraft, setEditingQueuePromptId]);

  const commitEdit = useCallback(async () => {
    if (!activeSessionId || editingPromptId == null) return;
    const trimmed = editDraft.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    // Resolve the prompt fresh at commit time from its stable promptId, then
    // derive the live seq. If the prompt vanished (executed/deleted while the
    // edit was open) cancel gracefully rather than editing the wrong row.
    const editingPrompt = pendingPrompts.find((prompt) => prompt.promptId === editingPromptId);
    if (!editingPrompt) {
      cancelEdit();
      return;
    }
    try {
      if (isLocallyEditableOutboxPrompt(editingPrompt)) {
        patchLocalOutboxPrompt(editingPrompt.promptId, trimmed);
      } else {
        await editPendingPrompt(activeSessionId, editingPrompt.seq, trimmed);
      }
    } finally {
      setEditDraft(activeSessionId, "");
      setEditingQueuePromptId(activeSessionId, null);
    }
  }, [
    activeSessionId,
    cancelEdit,
    editDraft,
    editPendingPrompt,
    editingPromptId,
    pendingPrompts,
    setEditDraft,
    setEditingQueuePromptId,
  ]);

  return {
    isEditing,
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
