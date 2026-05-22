import type { ContentPart, PromptProvenance } from "@anyharness/sdk";
import { summarizeContentParts } from "@/lib/domain/chat/composer/prompt-display-parts";
import type { PromptOutboxDeliveryState } from "@/lib/domain/sessions/intents/session-intent-model";
import {
  formatReviewFeedbackQueueText,
  formatWakePromptQueueText,
  isSubagentWakeProvenance,
} from "@proliferate/product-model/chats/subagents/provenance";

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
