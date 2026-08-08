import type { ContentPart, PromptProvenance } from "@anyharness/sdk";
import { summarizeContentParts } from "../composer/prompt-display-parts";
import type { PromptOutboxDeliveryState } from "../../sessions/intents/session-intent-model";
import {
  formatAgentWakePromptQueueText,
  formatReviewFeedbackQueueText,
  formatWakePromptQueueText,
  isAgentSessionProvenance,
  isAgentWakeProvenance,
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

/**
 * The agent an entry was queued BY. Present only for entries an agent put in
 * the queue - a wake pointer or an agent message - which the composer collapses
 * into one quiet "delivered next turn" row instead of showing their bodies.
 */
export interface PendingPromptQueueAgentSource {
  sessionId: string | null;
  sessionLinkId: string | null;
  label: string | null;
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
  /** Set iff an agent queued this entry. Null for the human's own messages. */
  agentSource: PendingPromptQueueAgentSource | null;
}

export function pendingPromptAgentSource(
  provenance: PendingPromptQueueEntry["promptProvenance"],
): PendingPromptQueueAgentSource | null {
  if (isSubagentWakeProvenance(provenance)) {
    return {
      // A link-scoped pointer names a link, not a session: the composer
      // resolves the session through the delegation link it already holds.
      sessionId: null,
      sessionLinkId: provenance.sessionLinkId,
      label: provenance.label ?? null,
    };
  }
  if (isAgentWakeProvenance(provenance)) {
    return {
      sessionId: provenance.targetSessionId,
      sessionLinkId: null,
      label: provenance.label ?? null,
    };
  }
  if (isAgentSessionProvenance(provenance)) {
    return {
      sessionId: provenance.sourceSessionId,
      sessionLinkId: null,
      label: provenance.label ?? null,
    };
  }
  return null;
}

export function derivePendingPromptQueueRow(
  entry: PendingPromptQueueEntry,
): PendingPromptQueueRow {
  const isRuntimeConfirmed = entry.seq > 0;
  // Queue seq is an immutable queue-entry identity. promptId belongs to the
  // local outbox reconciliation path and is neither required nor guaranteed
  // unique for runtime queue rows.
  const key = `seq:${entry.seq}`;
  const deleteAction = resolveDeleteAction(entry);
  const agentSource = pendingPromptAgentSource(entry.promptProvenance);
  const isSending =
    entry.localOutboxDeliveryState === "preparing"
    || entry.localOutboxDeliveryState === "dispatching";
  // Both wake kinds queue as the same row: a pointer is a pointer whether the
  // schedule hung off a delegation link or off a session pair.
  const wakeLabel = isSubagentWakeProvenance(entry.promptProvenance)
    ? formatWakePromptQueueText(entry.promptProvenance)
    : isAgentWakeProvenance(entry.promptProvenance)
      ? formatAgentWakePromptQueueText(entry.promptProvenance)
      : null;
  if (wakeLabel) {
    return {
      key,
      seq: entry.seq,
      promptId: entry.promptId ?? null,
      label: collapseQueueLabel(wakeLabel),
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
      agentSource,
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
      agentSource,
    };
  }

  const hasStructuredAttachments = entry.contentParts.some((part) => part.type !== "text");
  const isPreRuntimeAckPrompt = !isRuntimeConfirmed && !!entry.promptId;
  const canEditLocalPrompt =
    entry.localOutboxDeliveryState === "waiting_for_session"
    && !!entry.promptId;
  const showEditAction =
    (isRuntimeConfirmed || isPreRuntimeAckPrompt)
    && !hasStructuredAttachments;
  const showDeleteAction =
    deleteAction !== null || isPreRuntimeAckPrompt;
  const canEdit =
    (isRuntimeConfirmed || canEditLocalPrompt)
    && !hasStructuredAttachments;
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
    agentSource,
  };
}

export function findNewestEditablePendingPrompt(
  entries: readonly PendingPromptQueueEntry[],
): PendingPromptQueueEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && derivePendingPromptQueueRow(entry).canEdit) {
      return entry;
    }
  }
  return null;
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
