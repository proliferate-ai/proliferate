import { useCallback, useMemo } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Pencil, X } from "@proliferate/ui/icons";
import { ThinkingText } from "@/components/feedback/ThinkingText";
import { useActiveSessionId } from "@/hooks/chat/derived/use-active-session-identity";
import { usePromptOutboxActions } from "@/hooks/chat/workflows/use-prompt-outbox-actions";
import { useQueuedPromptEditReader } from "@/hooks/chat/ui/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "@/hooks/sessions/workflows/use-delete-pending-prompt";
import { CHAT_STREAMING_STATUS_LABELS } from "@/copy/chat/chat-copy";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueRow,
} from "@proliferate/product-domain/chats/pending-prompts/pending-prompt-queue";

export interface PendingPromptListProps {
  entries: PendingPromptQueueRow[];
  onBeginEdit: (seq: number) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
}

/**
 * Pure presentational queue list. Takes all data as props so it can be
 * rendered in isolation (e.g. from the dev playground). Production callers
 * should use `ConnectedPendingPromptList` which wires it to the chat-input
 * store and the pending-prompt projection.
 */
export function PendingPromptList({
  entries,
  onBeginEdit,
  onDelete,
}: PendingPromptListProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      // Queue panel rides the shared dock-panel shell (see
      // ComposerAttachedPanel): 13px top radius docking into the composer,
      // 0.5px border, 2% foreground tint. No backdrop blur — the dock bans
      // blur over the transcript (ChatComposerDock PERF note).
      className="relative flex flex-col overflow-clip rounded-t-[13px] border-x-[0.5px] border-t-[0.5px] border-border bg-[color:color-mix(in_oklab,var(--color-foreground)_2%,var(--color-background))] px-1.5 py-1.5"
      data-telemetry-mask
      aria-label="Queued messages"
    >
      {entries.map((entry) => (
        <PendingPromptRow
          key={entry.key}
          entry={entry}
          onBeginEdit={onBeginEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function ConnectedPendingPromptList() {
  const activeSessionId = useActiveSessionId();
  const { visiblePendingPrompts, beginEdit } = useQueuedPromptEditReader();
  const deletePendingPrompt = useDeletePendingPrompt();
  const { cancelBeforeDispatch, dismissPrompt } = usePromptOutboxActions();
  const rows = useMemo(
    () => visiblePendingPrompts.map(derivePendingPromptQueueRow),
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

  if (!activeSessionId) {
    return null;
  }

  return (
    <PendingPromptList
      entries={rows}
      onBeginEdit={handleBeginEdit}
      onDelete={handleDelete}
    />
  );
}

interface PendingPromptRowProps {
  entry: PendingPromptQueueRow;
  onBeginEdit: (seq: number) => void;
  onDelete: (entry: PendingPromptQueueRow) => void;
}

// Hover-reveal for the row's edit/remove affordances: keep the queue calm at
// rest instead of striping every row with always-on icon buttons.
const QUEUE_ROW_ACTION_CLASSNAME =
  "size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/queue-row:opacity-100 group-focus-within/queue-row:opacity-100";

function PendingPromptRow({
  entry,
  onBeginEdit,
  onDelete,
}: PendingPromptRowProps) {
  const {
    seq,
    label,
    isBeingEdited,
    isSending,
    showEditAction,
    canEdit,
    editDisabledReason,
    showDeleteAction,
    canDelete,
    deleteDisabledReason,
  } = entry;
  // While the entry is in flight the edit affordance is meaningless — the
  // "Sending…" hint owns the trailing slot. Delete stays only when it can
  // still act (cancel while preparing); a dead disabled X is just clutter.
  const renderEditAction = showEditAction && !isBeingEdited && !isSending;
  const renderDeleteAction = showDeleteAction && (!isSending || canDelete);

  const handleBeginEdit = useCallback(() => {
    if (!canEdit) return;
    onBeginEdit(seq);
  }, [canEdit, onBeginEdit, seq]);

  const handleDelete = useCallback(() => {
    if (!canDelete) return;
    onDelete(entry);
  }, [canDelete, entry, onDelete]);

  // One trailing state hint per row: sending shimmer > editing note > actions.
  const stateHint = isSending
    ? (
      <ThinkingText
        text={CHAT_STREAMING_STATUS_LABELS.sending}
        className="shrink-0 text-ui-sm font-normal leading-[var(--text-ui-sm--line-height)]"
      />
    )
    : isBeingEdited
      ? (
        <span className="shrink-0 text-ui-sm leading-[var(--text-ui-sm--line-height)] text-faint">
          Editing…
        </span>
      )
      : null;

  return (
    <div className="group/queue-row flex min-h-7 items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent">
      <div
        className={`min-w-0 flex-1 truncate text-ui leading-[var(--text-ui--line-height)] transition-colors ${
          isBeingEdited
            ? "text-muted-foreground/60"
            : "text-muted-foreground group-hover/queue-row:text-foreground"
        }`}
        title={label}
      >
        {label}
      </div>
      {stateHint}
      {renderEditAction && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canEdit}
          onClick={handleBeginEdit}
          className={QUEUE_ROW_ACTION_CLASSNAME}
          aria-label="Edit queued message"
          title={editDisabledReason ?? "Edit queued message"}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      {renderDeleteAction && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canDelete}
          onClick={handleDelete}
          className={QUEUE_ROW_ACTION_CLASSNAME}
          aria-label="Delete queued message"
          title={deleteDisabledReason ?? "Delete queued message"}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
