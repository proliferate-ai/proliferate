import type { ContentPart, PromptProvenance, TranscriptState } from "@anyharness/sdk";
import { summarizeContentParts } from "../composer/prompt-display-parts";
import type { PromptOutboxDeliveryState } from "../../sessions/intents/session-intent-model";
import {
  formatReviewFeedbackQueueText,
  isAgentSessionProvenance,
  isSubagentWakeProvenance,
} from "../subagents/provenance";

export type PendingPromptQueueRowKind = "plain" | "agent_updates" | "review_feedback";

export interface PendingPromptQueueAgent {
  sessionId: string;
  title: string;
  updateCount: number;
  provenance: {
    kind: "agent_session" | "link_wake" | "subagent_wake";
    sessionLinkId: string | null;
    relation: string | null;
  };
}

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
  /** Agent-update aggregate fields. Empty for ordinary/review rows. */
  agents: PendingPromptQueueAgent[];
  agentUpdateCount: number;
  agentUpdateSeqs: number[];
}

type LinkCompletionIndex = TranscriptState["linkCompletionsByCompletionId"];

export function derivePendingPromptQueueRows(
  entries: readonly PendingPromptQueueEntry[],
  linkCompletionsByCompletionId: LinkCompletionIndex = {},
): PendingPromptQueueRow[] {
  const visibleRows: PendingPromptQueueRow[] = [];
  const agentEntries: PendingPromptQueueEntry[] = [];

  for (const entry of entries) {
    if (isAgentOriginPendingEntry(entry)) {
      agentEntries.push(entry);
    } else {
      visibleRows.push(derivePendingPromptQueueRow(entry));
    }
  }

  if (agentEntries.length === 0) {
    return visibleRows;
  }

  const agentsBySessionId = new Map<string, PendingPromptQueueAgent>();
  for (const entry of agentEntries) {
    const provenance = entry.promptProvenance;
    if (isAgentSessionProvenance(provenance)) {
      const sessionId = provenance.sourceSessionId.trim();
      if (sessionId && !agentsBySessionId.has(sessionId)) {
        agentsBySessionId.set(sessionId, {
          sessionId,
          title: provenance.label?.trim() || "Agent",
          updateCount: 1,
          provenance: {
            kind: "agent_session",
            sessionLinkId: provenance.sessionLinkId ?? null,
            relation: null,
          },
        });
      } else if (sessionId) {
        const existing = agentsBySessionId.get(sessionId);
        if (existing) existing.updateCount += 1;
      }
      continue;
    }
    if (isSubagentWakeProvenance(provenance)) {
      const completion = linkCompletionsByCompletionId[provenance.completionId];
      const sessionId = completion?.childSessionId.trim() ?? "";
      if (sessionId && !agentsBySessionId.has(sessionId)) {
        agentsBySessionId.set(sessionId, {
          sessionId,
          title:
            provenance.label?.trim()
            || completion?.label?.trim()
            || (provenance.type === "linkWake" && provenance.relation === "cowork_coding_session"
              ? "Coding session"
              : "Subagent"),
          updateCount: 1,
          provenance: {
            kind: provenance.type === "linkWake" ? "link_wake" : "subagent_wake",
            sessionLinkId: provenance.sessionLinkId,
            relation: provenance.type === "linkWake" ? provenance.relation : "subagent",
          },
        });
      } else if (sessionId) {
        const existing = agentsBySessionId.get(sessionId);
        if (existing) existing.updateCount += 1;
      }
    }
  }

  const agentUpdateSeqs = agentEntries.map((entry) => entry.seq);
  visibleRows.push({
    key: "agent-updates",
    seq: 0,
    promptId: null,
    label: "From subagents",
    kind: "agent_updates",
    isBeingEdited: false,
    isSending: false,
    showEditAction: false,
    canEdit: false,
    editDisabledReason: null,
    showDeleteAction: false,
    canDelete: false,
    deleteDisabledReason: null,
    deleteAction: null,
    agents: [...agentsBySessionId.values()],
    agentUpdateCount: agentEntries.length,
    agentUpdateSeqs,
  });
  return visibleRows;
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
  const isSending =
    entry.localOutboxDeliveryState === "preparing"
    || entry.localOutboxDeliveryState === "dispatching";
  const wakeProvenance = isSubagentWakeProvenance(entry.promptProvenance)
    ? entry.promptProvenance
    : null;
  const agentSessionProvenance = isAgentSessionProvenance(entry.promptProvenance)
    ? entry.promptProvenance
    : null;
  if (wakeProvenance || agentSessionProvenance) {
    return {
      key,
      seq: entry.seq,
      promptId: entry.promptId ?? null,
      label: "From subagents",
      kind: "agent_updates",
      isBeingEdited: entry.isBeingEdited,
      isSending,
      showEditAction: false,
      canEdit: false,
      editDisabledReason: null,
      showDeleteAction: false,
      canDelete: false,
      deleteDisabledReason: null,
      deleteAction: null,
      agents: [],
      agentUpdateCount: 1,
      agentUpdateSeqs: [entry.seq],
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
      agents: [],
      agentUpdateCount: 0,
      agentUpdateSeqs: [],
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
    agents: [],
    agentUpdateCount: 0,
    agentUpdateSeqs: [],
  };
}

export function isAgentOriginPendingEntry(entry: PendingPromptQueueEntry): boolean {
  return isSubagentWakeProvenance(entry.promptProvenance)
    || isAgentSessionProvenance(entry.promptProvenance);
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
