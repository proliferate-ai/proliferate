import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Pencil, X } from "@/components/ui/icons";
import { useActiveSessionId } from "@/hooks/chat/use-active-chat-session-selectors";
import { useQueuedPromptEditReader } from "@/hooks/chat/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "@/hooks/sessions/use-delete-pending-prompt";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueRow,
} from "@/lib/domain/chat/pending-prompt-queue";

export interface PendingPromptListProps {
  entries: PendingPromptQueueRow[];
  onBeginEdit: (seq: number) => void;
  onDelete: (seq: number) => void;
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
      className="relative flex flex-col gap-1 overflow-clip rounded-t-2xl border-x border-t border-border/70 bg-card/70 px-2 py-1.5 backdrop-blur-sm"
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
  const rows = useMemo(
    () => visiblePendingPrompts.map(derivePendingPromptQueueRow),
    [visiblePendingPrompts],
  );

  const handleDelete = useCallback(
    (seq: number) => {
      if (!activeSessionId) return;
      void deletePendingPrompt(activeSessionId, seq);
    },
    [activeSessionId, deletePendingPrompt],
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
  onDelete: (seq: number) => void;
}

function PendingPromptRow({
  entry,
  onBeginEdit,
  onDelete,
}: PendingPromptRowProps) {
  const { seq, label, isBeingEdited, canEdit, canDelete } = entry;
  const showEditAction = canEdit && !isBeingEdited;

  const handleBeginEdit = useCallback(() => {
    if (!showEditAction) return;
    onBeginEdit(seq);
  }, [onBeginEdit, seq, showEditAction]);

  const handleDelete = useCallback(() => {
    onDelete(seq);
  }, [onDelete, seq]);

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-muted/40">
      <div
        className={`min-w-0 flex-1 truncate text-sm leading-snug text-foreground/90 ${
          isBeingEdited ? "pointer-events-none opacity-60" : ""
        }`}
        title={label}
      >
        {label}
      </div>
      {isBeingEdited ? (
        <div className="shrink-0 text-xs italic text-muted-foreground">
          editing in composer…
        </div>
      ) : showEditAction ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleBeginEdit}
          className="shrink-0 opacity-60 hover:opacity-100"
          aria-label="Edit queued message"
          title="Edit queued message"
        >
          <Pencil className="size-3.5" />
        </Button>
      ) : null}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          className="shrink-0 opacity-60 hover:opacity-100"
          aria-label="Delete queued message"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
