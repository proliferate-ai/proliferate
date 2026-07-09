import type { ContentPart, PromptProvenance } from "@anyharness/sdk";
import { summarizeContentParts } from "../composer/prompt-display-parts";
import type { PromptOutboxDeliveryState } from "../../sessions/intents/session-intent-model";
import {
  formatReviewFeedbackQueueText,
  formatWakePromptQueueText,
  isSubagentWakeProvenance,
} from "../subagents/provenance";

export type PendingPromptQueueRowKind = "plain" | "wake" | "review_feedback";

export interface PendingPromptQueueEntry {
  seq: number;
  promptId?: string | null;
  text: string;
  contentParts: ContentPart[];
  isBeingEdited: boolean;
  promptProvenance?: PromptProvenance | null;
  localOutboxDeliveryState?: PromptOutboxDeliveryState | null;
}

export interface PendingPromptQueueRow {
  key: string;
  seq: number;
  promptId: string | null;
  label: string;
  kind: PendingPromptQueueRowKind;
  isBeingEdited: boolean;
  /**
   * The entry is in flight to the runtime (outbox preparing/dispatching).
   * Presentation-only: queue rows show a "Sending…" state hint while true —
   * the edit/delete wiring is unchanged and still governed by the flags below.
   */
  isSending: boolean;
  showEditAction: boolean;
  canEdit: boolean;
  editDisabledReason: string | null;
  showDeleteAction: boolean;
  canDelete: boolean;
  deleteDisabledReason: string | null;
  deleteAction: "runtime" | "cancel_local" | "dismiss_local" | null;
}

export function derivePendingPromptQueueRow(
  entry: PendingPromptQueueEntry,
): PendingPromptQueueRow {
  const isRuntimeConfirmed = entry.seq > 0;
  const key = entry.promptId ? `prompt:${entry.promptId}` : `seq:${entry.seq}`;
  const deleteAction = resolveDeleteAction(entry);
  const isSending =
    entry.localOutboxDeliveryState === "preparing"
    || entry.localOutboxDeliveryState === "dispatching";
  const wakeProvenance = isSubagentWakeProvenance(entry.promptProvenance)
    ? entry.promptProvenance
    : null;
  if (wakeProvenance) {
    return {
      key,
      seq: entry.seq,
      promptId: entry.promptId ?? null,
      label: collapseQueueLabel(formatWakePromptQueueText(wakeProvenance)),
      kind: "wake",
      isBeingEdited: entry.isBeingEdited,
      isSending,
      showEditAction: false,
      canEdit: false,
      editDisabledReason: null,
      showDeleteAction: deleteAction !== null && isRuntimeConfirmed,
      canDelete: deleteAction !== null && isRuntimeConfirmed,
      deleteDisabledReason: null,
      deleteAction: isRuntimeConfirmed ? deleteAction : null,
    };
  }

  const reviewLabel = formatReviewFeedbackQueueText({
    provenance: entry.promptProvenance,
    text: entry.text,
  });
  if (reviewLabel) {
    return {
      key,
      seq: entry.seq,
      promptId: entry.promptId ?? null,
      label: collapseQueueLabel(reviewLabel),
      kind: "review_feedback",
      isBeingEdited: entry.isBeingEdited,
      isSending,
      showEditAction: false,
      canEdit: false,
      editDisabledReason: null,
      showDeleteAction: deleteAction !== null && isRuntimeConfirmed,
      canDelete: deleteAction !== null && isRuntimeConfirmed,
      deleteDisabledReason: null,
      deleteAction: isRuntimeConfirmed ? deleteAction : null,
    };
  }

  const hasStructuredAttachments = entry.contentParts.some((part) => part.type !== "text");
  const isPreRuntimeAckPrompt = !isRuntimeConfirmed && !!entry.promptId;
  const canEditLocalPrompt =
    entry.localOutboxDeliveryState === "waiting_for_session"
    && !!entry.promptId;
  const showEditAction =
    (isRuntimeConfirmed || isPreRuntimeAckPrompt) && !hasStructuredAttachments;
  const showDeleteAction =
    deleteAction !== null || isPreRuntimeAckPrompt;
  const canEdit =
    (isRuntimeConfirmed || canEditLocalPrompt) && !hasStructuredAttachments;
  const canDelete = deleteAction !== null;
  return {
    key,
    seq: entry.seq,
    promptId: entry.promptId ?? null,
    label: collapseQueueLabel(summarizeContentParts(entry.contentParts, entry.text)) || "Queued message",
    kind: "plain",
    isBeingEdited: entry.isBeingEdited,
    isSending,
    showEditAction,
    canEdit,
    editDisabledReason: showEditAction && !canEdit ? "Available once queued" : null,
    showDeleteAction,
    canDelete,
    deleteDisabledReason: showDeleteAction && !canDelete ? "Available once queued" : null,
    deleteAction,
  };
}

function resolveDeleteAction(
  entry: PendingPromptQueueEntry,
): PendingPromptQueueRow["deleteAction"] {
  if (entry.seq > 0) {
    return "runtime";
  }
  if (!entry.promptId) {
    return null;
  }
  if (
    entry.localOutboxDeliveryState === "waiting_for_session"
    || entry.localOutboxDeliveryState === "preparing"
  ) {
    return "cancel_local";
  }
  if (entry.localOutboxDeliveryState === "unknown_after_dispatch") {
    return "dismiss_local";
  }
  return null;
}

function collapseQueueLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
