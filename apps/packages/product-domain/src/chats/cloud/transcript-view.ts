import type {
  SessionEventEnvelope,
  TranscriptState,
} from "@anyharness/sdk";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import type { TranscriptVirtualRow } from "../transcript/transcript-virtual-rows";
import { reconstructTranscriptState } from "../transcript/envelope-to-state";
import {
  applyInteractionCommandDetails,
  applyPendingInteractionRows,
} from "./transcript-view-interactions";
import {
  buildRowsFromProjectedItems,
  latestProjectedItemSeq,
} from "./transcript-view-projected-items";
import { buildTranscriptStateFromProjectedItems } from "./transcript-view-projected-state";
import {
  buildRowsFromTranscriptState,
  buildRowsFromTurnRow,
} from "./transcript-view-rows";
import {
  isSessionEventEnvelope,
  latestTranscriptRowSeq,
} from "./transcript-view-utils";
import type {
  CloudChatTranscriptRowView,
  CloudTranscriptStateFallbackReason,
  CloudTranscriptStateResult,
  CloudTranscriptViewResult,
} from "./transcript-view-model";

export type {
  CloudChatTranscriptRowKind,
  CloudChatTranscriptRowView,
  CloudOptimisticPromptReference,
  CloudTranscriptStateFallbackReason,
  CloudTranscriptStateResult,
  CloudTranscriptStateSource,
  CloudTranscriptViewResult,
} from "./transcript-view-model";

export {
  cloudPendingInteractionsRequireProjectedRows,
} from "./transcript-view-interactions";

export {
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
  latestCloudTranscriptSeq,
} from "./transcript-view-progress";

export function buildCloudTranscriptState(input: {
  sessionId: string | null;
  events: readonly CloudSessionEvent[];
  fallbackItems?: readonly CloudTranscriptItem[];
}): CloudTranscriptStateResult {
  const fallbackItems = input.fallbackItems ?? [];
  const latestProjectedSeq = latestProjectedItemSeq(fallbackItems);
  if (!input.sessionId) {
    return emptyCloudTranscriptState({
      latestProjectedSeq,
      fallbackReason: "empty",
    });
  }

  const envelopes = input.events
    .map((event) => event.envelope)
    .filter(isSessionEventEnvelope);
  const missingEnvelopeCount = input.events.length - envelopes.length;
  const latestEnvelopeSeq = latestEnvelopeSeqFromEvents(envelopes);

  if (envelopes.length === 0) {
    const projectionTranscript = fallbackItems.length > 0
      ? buildTranscriptStateFromProjectedItems(input.sessionId, fallbackItems)
      : null;
    return {
      transcript: projectionTranscript,
      source: fallbackItems.length > 0 ? "projection" : "empty",
      envelopeCount: 0,
      missingEnvelopeCount,
      latestEnvelopeSeq,
      latestProjectedSeq,
      fallbackReason: fallbackItems.length > 0 ? "missing_envelopes" : "empty",
    };
  }

  const transcript = reconstructTranscriptState(input.sessionId, envelopes);
  const rows = buildRowsFromTranscriptState(transcript);
  if (rows.length === 0) {
    const projectionTranscript = fallbackItems.length > 0
      ? buildTranscriptStateFromProjectedItems(input.sessionId, fallbackItems)
      : null;
    return {
      transcript: projectionTranscript,
      source: fallbackItems.length > 0 ? "projection" : "empty",
      envelopeCount: envelopes.length,
      missingEnvelopeCount,
      latestEnvelopeSeq,
      latestProjectedSeq,
      fallbackReason: "no_renderable_event_rows",
    };
  }
  if (!shouldUseEventRows(
    { events: input.events, fallbackItems },
    rows,
    missingEnvelopeCount,
  )) {
    const projectionTranscript = fallbackItems.length > 0
      ? buildTranscriptStateFromProjectedItems(input.sessionId, fallbackItems)
      : null;
    return {
      transcript: projectionTranscript,
      source: fallbackItems.length > 0 ? "projection" : "empty",
      envelopeCount: envelopes.length,
      missingEnvelopeCount,
      latestEnvelopeSeq,
      latestProjectedSeq,
      fallbackReason: latestProjectedSeq > latestTranscriptRowSeq(rows)
        ? "projection_ahead_of_events"
        : "missing_envelopes",
    };
  }

  return {
    transcript,
    source: "events",
    envelopeCount: envelopes.length,
    missingEnvelopeCount,
    latestEnvelopeSeq,
    latestProjectedSeq,
    fallbackReason: null,
  };
}

export function buildCloudTranscriptView(input: {
  sessionId: string | null;
  events: readonly CloudSessionEvent[];
  fallbackItems: readonly CloudTranscriptItem[];
  pendingInteractions?: readonly CloudPendingInteraction[];
}): CloudTranscriptViewResult {
  if (!input.sessionId) {
    return emptyCloudTranscriptView();
  }

  const state = buildCloudTranscriptState({
    sessionId: input.sessionId,
    events: input.events,
    fallbackItems: input.fallbackItems,
  });

  if (state.transcript) {
    const rows = applyInteractionCommandDetails(
      buildRowsFromTranscriptState(state.transcript),
      input.events,
    );
    return {
      rows: applyPendingInteractionRows(
        rows,
        input.pendingInteractions ?? [],
        input.fallbackItems,
      ),
      source: state.source,
      envelopeCount: state.envelopeCount,
      missingEnvelopeCount: state.missingEnvelopeCount,
    };
  }

  if (input.fallbackItems.length > 0) {
    return {
      rows: applyPendingInteractionRows(
        buildRowsFromProjectedItems(input.fallbackItems),
        input.pendingInteractions ?? [],
        input.fallbackItems,
      ),
      source: "projection",
      envelopeCount: state.envelopeCount,
      missingEnvelopeCount: state.missingEnvelopeCount,
    };
  }

  return {
    rows: applyPendingInteractionRows([], input.pendingInteractions ?? []),
    source: "empty",
    envelopeCount: state.envelopeCount,
    missingEnvelopeCount: state.missingEnvelopeCount,
  };
}

export function buildCloudTranscriptRowsFromTurnRow(input: {
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>;
  transcript: TranscriptState;
}): CloudChatTranscriptRowView[] {
  return buildRowsFromTurnRow(input.row, input.transcript);
}

function emptyCloudTranscriptState(input: {
  latestProjectedSeq: number;
  fallbackReason: CloudTranscriptStateFallbackReason;
}): CloudTranscriptStateResult {
  return {
    transcript: null,
    source: "empty",
    envelopeCount: 0,
    missingEnvelopeCount: 0,
    latestEnvelopeSeq: 0,
    latestProjectedSeq: input.latestProjectedSeq,
    fallbackReason: input.fallbackReason,
  };
}

function latestEnvelopeSeqFromEvents(
  envelopes: readonly SessionEventEnvelope[],
): number {
  return envelopes.reduce((maxSeq, envelope) => Math.max(maxSeq, envelope.seq), 0);
}

function shouldUseEventRows(
  input: {
    events: readonly CloudSessionEvent[];
    fallbackItems: readonly CloudTranscriptItem[];
  },
  rows: readonly CloudChatTranscriptRowView[],
  missingEnvelopeCount: number,
): boolean {
  if (latestProjectedItemSeq(input.fallbackItems) > latestTranscriptRowSeq(rows)) {
    return false;
  }
  if (missingEnvelopeCount === 0 || input.fallbackItems.length === 0) {
    return true;
  }
  return projectedItemsAreCoveredByRows(input.fallbackItems, rows);
}

function projectedItemsAreCoveredByRows(
  items: readonly CloudTranscriptItem[],
  rows: readonly CloudChatTranscriptRowView[],
): boolean {
  return items.every((item) => projectedItemIsCoveredByRows(item, rows));
}

function projectedItemIsCoveredByRows(
  item: CloudTranscriptItem,
  rows: readonly CloudChatTranscriptRowView[],
): boolean {
  return rows.some((row) => rowCoversProjectedItem(row, item));
}

function rowCoversProjectedItem(
  row: CloudChatTranscriptRowView,
  item: CloudTranscriptItem,
): boolean {
  const firstSeq = row.firstSeq ?? row.lastSeq ?? null;
  const lastSeq = row.lastSeq ?? row.firstSeq ?? null;
  const coversSelf = typeof firstSeq === "number"
    && typeof lastSeq === "number"
    && firstSeq <= item.firstSeq
    && lastSeq >= item.lastSeq;
  if (coversSelf) {
    return true;
  }
  return row.children?.some((child) => rowCoversProjectedItem(child, item)) ?? false;
}

function emptyCloudTranscriptView(): CloudTranscriptViewResult {
  return {
    rows: [],
    source: "empty",
    envelopeCount: 0,
    missingEnvelopeCount: 0,
  };
}
