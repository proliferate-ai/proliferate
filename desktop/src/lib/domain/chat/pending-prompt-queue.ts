import type { ContentPart, PromptProvenance } from "@anyharness/sdk";
import { summarizeContentParts } from "@/lib/domain/chat/prompt-content";
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
}

export interface PendingPromptQueueRow {
  key: string;
  seq: number;
  label: string;
  kind: PendingPromptQueueRowKind;
  isBeingEdited: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function derivePendingPromptQueueRow(
  entry: PendingPromptQueueEntry,
): PendingPromptQueueRow {
  const isRuntimeConfirmed = entry.seq > 0;
  const key = entry.promptId ? `prompt:${entry.promptId}` : `seq:${entry.seq}`;
  const wakeProvenance = isSubagentWakeProvenance(entry.promptProvenance)
    ? entry.promptProvenance
    : null;
  if (wakeProvenance) {
    return {
      key,
      seq: entry.seq,
      label: collapseQueueLabel(formatWakePromptQueueText(wakeProvenance)),
      kind: "wake",
      isBeingEdited: entry.isBeingEdited,
      canEdit: false,
      canDelete: isRuntimeConfirmed,
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
      label: collapseQueueLabel(reviewLabel),
      kind: "review_feedback",
      isBeingEdited: entry.isBeingEdited,
      canEdit: false,
      canDelete: isRuntimeConfirmed,
    };
  }

  const hasStructuredAttachments = entry.contentParts.some((part) => part.type !== "text");
  return {
    key,
    seq: entry.seq,
    label: collapseQueueLabel(summarizeContentParts(entry.contentParts, entry.text)) || "Queued message",
    kind: "plain",
    isBeingEdited: entry.isBeingEdited,
    canEdit: isRuntimeConfirmed && !hasStructuredAttachments,
    canDelete: isRuntimeConfirmed,
  };
}

function collapseQueueLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
