import type { ContentPart, PromptProvenance } from "@anyharness/sdk";
import { summarizeContentParts } from "@/lib/domain/chat/composer/prompt-content";
import type { PromptOutboxDeliveryState } from "@/lib/domain/chat/outbox/prompt-outbox";
import {
  formatReviewFeedbackQueueText,
  formatWakePromptQueueText,
  isSubagentWakeProvenance,
} from "@/lib/domain/chat/subagents/provenance";

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
  canEdit: boolean;
  canDelete: boolean;
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
      canEdit: false,
      canDelete: deleteAction !== null && isRuntimeConfirmed,
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
      canEdit: false,
      canDelete: deleteAction !== null && isRuntimeConfirmed,
      deleteAction: isRuntimeConfirmed ? deleteAction : null,
    };
  }

  const hasStructuredAttachments = entry.contentParts.some((part) => part.type !== "text");
  return {
    key,
    seq: entry.seq,
    promptId: entry.promptId ?? null,
    label: collapseQueueLabel(summarizeContentParts(entry.contentParts, entry.text)) || "Queued message",
    kind: "plain",
    isBeingEdited: entry.isBeingEdited,
    canEdit: isRuntimeConfirmed && !hasStructuredAttachments,
    canDelete: deleteAction !== null,
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
