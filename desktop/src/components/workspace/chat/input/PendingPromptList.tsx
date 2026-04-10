import { useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Pencil, X } from "@/components/ui/icons";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useQueuedPromptEditReader } from "@/hooks/chat/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "@/hooks/sessions/use-delete-pending-prompt";

export interface PendingPromptListEntry {
  seq: number;
  text: string;
  isBeingEdited: boolean;
}

export interface PendingPromptListProps {
  entries: PendingPromptListEntry[];
  onBeginEdit: (args: { seq: number; text: string }) => void;
  onDelete: (seq: number) => void;
}

/**
 * Pure presentational queue list. Takes all data as props so it can be
 * rendered in isolation (e.g. from the dev playground). Production callers
 * should use `ConnectedPendingPromptList` which wires it to the chat-input
 * store and the pending-prompt projection.
 */
export function PendingPromptList({ entries, onBeginEdit, onDelete }: PendingPromptListProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      className="relative flex flex-col gap-1 overflow-clip rounded-t-2xl border-x border-t border-border/80 bg-card/70 px-2 py-1.5 backdrop-blur-sm"
      data-telemetry-mask
      aria-label="Queued messages"
    >
      {entries.map((entry) => (
        <PendingPromptRow
          key={entry.seq}
          entry={entry}
          onBeginEdit={onBeginEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function ConnectedPendingPromptList() {
  const { activeSessionId } = useActiveChatSessionState();
  const { visiblePendingPrompts, beginEdit } = useQueuedPromptEditReader();
  const deletePendingPrompt = useDeletePendingPrompt();

  const handleDelete = useCallback(
    (seq: number) => {
      if (!activeSessionId) return;
      void deletePendingPrompt(activeSessionId, seq);
    },
    [activeSessionId, deletePendingPrompt],
  );

  if (!activeSessionId) {
    return null;
  }

  return (
    <PendingPromptList
      entries={visiblePendingPrompts}
      onBeginEdit={beginEdit}
      onDelete={handleDelete}
    />
  );
}

interface PendingPromptRowProps {
  entry: PendingPromptListEntry;
  onBeginEdit: (args: { seq: number; text: string }) => void;
  onDelete: (seq: number) => void;
}

function PendingPromptRow({ entry, onBeginEdit, onDelete }: PendingPromptRowProps) {
  const { seq, text, isBeingEdited } = entry;

  const handleBeginEdit = useCallback(() => {
    onBeginEdit({ seq, text });
  }, [onBeginEdit, seq, text]);

  const handleDelete = useCallback(() => {
    onDelete(seq);
  }, [onDelete, seq]);

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-muted/40">
      <div
        className={`min-w-0 flex-1 truncate text-sm leading-snug text-foreground/90 ${
          isBeingEdited ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {text}
      </div>
      {isBeingEdited ? (
        <div className="shrink-0 text-xs italic text-muted-foreground">
          editing in composer…
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleBeginEdit}
          className="shrink-0 opacity-60 hover:opacity-100"
          aria-label="Edit queued message"
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleDelete}
        className="shrink-0 opacity-60 hover:opacity-100"
        aria-label="Delete queued message"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
