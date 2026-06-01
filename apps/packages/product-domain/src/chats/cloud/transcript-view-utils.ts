import type {
  SessionEventEnvelope,
  TranscriptItem,
} from "@anyharness/sdk";
import type {
  CloudChatTranscriptRowView,
  CloudOptimisticPromptReference,
} from "./transcript-view-model";

const MAX_BODY_PREVIEW_LENGTH = 2_000;

export function latestTranscriptRowSeq(rows: readonly CloudChatTranscriptRowView[]): number {
  let latestSeq = 0;
  for (const row of rows) {
    latestSeq = Math.max(latestSeq, row.lastSeq ?? row.firstSeq ?? 0);
    if (row.children) {
      latestSeq = Math.max(latestSeq, latestTranscriptRowSeq(row.children));
    }
  }
  return latestSeq;
}

export function transcriptItemSeq(item: TranscriptItem): { firstSeq: number; lastSeq: number } {
  return {
    firstSeq: item.startedSeq,
    lastSeq: "lastUpdatedSeq" in item
      ? item.completedSeq ?? item.lastUpdatedSeq
      : item.startedSeq,
  };
}

export function transcriptItemStatus(item: TranscriptItem) {
  return item.kind === "unknown" ? null : item.status;
}

export function transcriptItemCompletedAt(item: TranscriptItem | null): string | null {
  if (!item || item.kind === "unknown") {
    return null;
  }
  return item.completedAt;
}

export function previewText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length <= MAX_BODY_PREVIEW_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_BODY_PREVIEW_LENGTH).trimEnd()}\n...`;
}

export function formatCount(count: number, singular: string): string | null {
  if (count <= 0) {
    return null;
  }
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function statusLabel(status: string | null | undefined): string | undefined {
  if (!status) {
    return undefined;
  }
  return status.replace(/_/g, " ");
}

export function isSessionEventEnvelope(value: unknown): value is SessionEventEnvelope {
  if (!isRecord(value) || !isRecord(value.event)) {
    return false;
  }
  return typeof value.sessionId === "string"
    && typeof value.seq === "number"
    && typeof value.event.type === "string";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function isPromptTranscriptKind(kind: string | null | undefined): boolean {
  return kind === "user_message" || kind === "prompt";
}

export function rowIsAfterPromptBaseline(
  row: CloudChatTranscriptRowView,
  prompt: CloudOptimisticPromptReference,
): boolean {
  return typeof row.firstSeq === "number" && row.firstSeq > prompt.baseTranscriptSeq;
}

export function rowIsAfterSeq(row: CloudChatTranscriptRowView, seq: number): boolean {
  return typeof row.firstSeq === "number" && row.firstSeq > seq;
}

export function textMatches(value: string | null | undefined, expected: string): boolean {
  return normalizePromptText(value) === normalizePromptText(expected);
}

function normalizePromptText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}
