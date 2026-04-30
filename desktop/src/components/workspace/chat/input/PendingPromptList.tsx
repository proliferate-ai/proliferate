import { useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Pencil, X } from "@/components/ui/icons";
import type { ContentPart, PromptProvenance } from "@anyharness/sdk";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useQueuedPromptEditReader } from "@/hooks/chat/use-queued-prompt-edit";
import { useDeletePendingPrompt } from "@/hooks/sessions/use-delete-pending-prompt";
import { PromptContentRenderer } from "@/components/workspace/chat/content/PromptContentRenderer";
import { SubagentWakeBadge } from "@/components/workspace/chat/transcript/SubagentWakeBadge";
import { ReviewFeedbackSummary } from "@/components/workspace/reviews/ReviewFeedbackSummary";
import {
  resolveReviewFeedbackPromptReference,
  isSubagentWakeProvenance,
} from "@/lib/domain/chat/subagents/provenance";
import { resolveSubagentColor } from "@/lib/domain/chat/subagent-braille-color";
import { useSessionSelectionActions } from "@/hooks/sessions/use-session-selection-actions";
import { useToastStore } from "@/stores/toast/toast-store";

export interface PendingPromptListEntry {
  seq: number;
  text: string;
  contentParts: ContentPart[];
  isBeingEdited: boolean;
  promptProvenance?: PromptProvenance | null;
}

export interface PendingPromptListProps {
  sessionId: string | null;
  entries: PendingPromptListEntry[];
  onBeginEdit: (args: { seq: number; text: string }) => void;
  onDelete: (seq: number) => void;
  onOpenSession?: (sessionId: string) => void;
}

/**
 * Pure presentational queue list. Takes all data as props so it can be
 * rendered in isolation (e.g. from the dev playground). Production callers
 * should use `ConnectedPendingPromptList` which wires it to the chat-input
 * store and the pending-prompt projection.
 */
export function PendingPromptList({
  sessionId,
  entries,
  onBeginEdit,
  onDelete,
  onOpenSession,
}: PendingPromptListProps) {
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
          sessionId={sessionId}
          entry={entry}
          onBeginEdit={onBeginEdit}
          onDelete={onDelete}
          onOpenSession={onOpenSession}
        />
      ))}
    </div>
  );
}

export function ConnectedPendingPromptList() {
  const { activeSessionId } = useActiveChatSessionState();
  const { visiblePendingPrompts, beginEdit } = useQueuedPromptEditReader();
  const deletePendingPrompt = useDeletePendingPrompt();
  const { selectSession } = useSessionSelectionActions();
  const showToast = useToastStore((state) => state.show);

  const handleDelete = useCallback(
    (seq: number) => {
      if (!activeSessionId) return;
      void deletePendingPrompt(activeSessionId, seq);
    },
    [activeSessionId, deletePendingPrompt],
  );
  const handleOpenSession = useCallback((sessionId: string) => {
    void selectSession(sessionId).catch((error) => {
      showToast(`Failed to open reviewer session: ${errorMessage(error)}`);
    });
  }, [selectSession, showToast]);

  if (!activeSessionId) {
    return null;
  }

  return (
    <PendingPromptList
      entries={visiblePendingPrompts}
      sessionId={activeSessionId}
      onBeginEdit={beginEdit}
      onDelete={handleDelete}
      onOpenSession={handleOpenSession}
    />
  );
}

interface PendingPromptRowProps {
  entry: PendingPromptListEntry;
  sessionId: string | null;
  onBeginEdit: (args: { seq: number; text: string }) => void;
  onDelete: (seq: number) => void;
  onOpenSession?: (sessionId: string) => void;
}

function PendingPromptRow({
  entry,
  sessionId,
  onBeginEdit,
  onDelete,
  onOpenSession,
}: PendingPromptRowProps) {
  const { seq, text, isBeingEdited } = entry;
  const hasStructuredAttachments = entry.contentParts.some((part) => part.type !== "text");
  const wakeProvenance = isSubagentWakeProvenance(entry.promptProvenance)
    ? entry.promptProvenance
    : null;
  const reviewFeedbackReference = resolveReviewFeedbackPromptReference(
    entry.promptProvenance,
    entry.text,
  );

  const handleBeginEdit = useCallback(() => {
    if (hasStructuredAttachments) {
      return;
    }
    onBeginEdit({ seq, text });
  }, [hasStructuredAttachments, onBeginEdit, seq, text]);

  const handleDelete = useCallback(() => {
    onDelete(seq);
  }, [onDelete, seq]);

  if (wakeProvenance) {
    return (
      <div className="flex justify-end">
        <SubagentWakeBadge
          label={wakeProvenance.label ?? null}
          color={resolveSubagentColor(wakeProvenance.sessionLinkId)}
          titleFallback={
            wakeProvenance.type === "linkWake"
            && wakeProvenance.relation === "cowork_coding_session"
              ? "Coding session"
              : "Subagent"
          }
        />
      </div>
    );
  }

  if (reviewFeedbackReference) {
    return (
      <ReviewFeedbackSummary
        reference={reviewFeedbackReference}
        sessionId={sessionId}
        state="queued"
        onOpenSession={onOpenSession}
      />
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-muted/40">
      <div
        className={`min-w-0 flex-1 text-sm leading-snug text-foreground/90 ${
          isBeingEdited ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <PromptContentRenderer
          sessionId={sessionId}
          parts={entry.contentParts}
          fallbackText={text}
          compact
        />
      </div>
      {isBeingEdited ? (
        <div className="shrink-0 text-xs italic text-muted-foreground">
          editing in composer…
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={hasStructuredAttachments}
          onClick={handleBeginEdit}
          className="shrink-0 opacity-60 hover:opacity-100"
          aria-label={hasStructuredAttachments
            ? "Queued messages with attachments cannot be edited"
            : "Edit queued message"}
          title={hasStructuredAttachments
            ? "Queued messages with attachments cannot be edited"
            : "Edit queued message"}
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
