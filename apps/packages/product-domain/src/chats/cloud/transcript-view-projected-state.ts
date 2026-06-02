import {
  createTranscriptState,
  type ContentPart,
  type TranscriptItem,
  type TranscriptItemStatus,
  type TranscriptState,
} from "@anyharness/sdk";
import type { CloudTranscriptItem } from "@proliferate/cloud-sdk";
import {
  isRecord,
  readString,
  transcriptItemCompletedAt,
  transcriptItemStatus,
} from "./transcript-view-utils";
import {
  projectedItemPromptId,
  projectedItemToolCallId,
  projectedItemLooksLikeShellTool,
  projectedPayloadItem,
  projectedPayloadText,
} from "./transcript-view-projected-items";

export function buildTranscriptStateFromProjectedItems(
  sessionId: string,
  items: readonly CloudTranscriptItem[],
): TranscriptState {
  const transcript = createTranscriptState(sessionId);
  const sortedItems = [...items].sort((left, right) => left.firstSeq - right.firstSeq);
  const turnIds = new Set<string>();
  let latestTimestamp: string | null = null;
  let sourceAgentKind: string | null = null;

  for (const item of sortedItems) {
    const turnId = item.turnId ?? `projection-turn:${item.firstSeq}`;
    const timestamp = item.firstEventAt ?? item.lastEventAt ?? "1970-01-01T00:00:00.000Z";
    latestTimestamp = item.lastEventAt ?? item.firstEventAt ?? latestTimestamp;
    sourceAgentKind = sourceAgentKind ?? item.sourceAgentKind ?? null;

    if (!turnIds.has(turnId)) {
      turnIds.add(turnId);
      transcript.turnOrder.push(turnId);
      transcript.turnsById[turnId] = {
        turnId,
        itemOrder: [],
        startedAt: timestamp,
        completedAt: null,
        stopReason: null,
        fileBadges: [],
      };
    }

    const projected = projectedItemToTranscriptItem(item, turnId);
    if (!projected) {
      continue;
    }
    transcript.itemsById[projected.itemId] = projected;
    transcript.turnsById[turnId]?.itemOrder.push(projected.itemId);
    transcript.lastSeq = Math.max(
      transcript.lastSeq,
      item.lastSeq,
      item.completedSeq ?? 0,
    );
    if (transcriptItemStatus(projected) === "in_progress") {
      transcript.isStreaming = true;
    }
  }

  for (const turnId of transcript.turnOrder) {
    const turn = transcript.turnsById[turnId];
    if (!turn) {
      continue;
    }
    const turnItems = turn.itemOrder
      .map((itemId) => transcript.itemsById[itemId])
      .filter((item): item is TranscriptItem => Boolean(item));
    const latestTurnItem = turnItems[turnItems.length - 1] ?? null;
    const hasStreamingItem = turnItems.some((item) => transcriptItemStatus(item) === "in_progress");
    turn.completedAt = hasStreamingItem ? null : transcriptItemCompletedAt(latestTurnItem);
  }

  transcript.sessionMeta.updatedAt = latestTimestamp;
  transcript.sessionMeta.sourceAgentKind = sourceAgentKind;
  return transcript;
}

function projectedItemToTranscriptItem(
  item: CloudTranscriptItem,
  turnId: string,
): TranscriptItem | null {
  const payloadItem = projectedPayloadItem(item.payload);
  const contentParts = projectedContentParts(item, payloadItem);
  const text = item.text ?? projectedPayloadText(item.payload) ?? "";
  const base = {
    itemId: item.itemId,
    turnId,
    status: projectedTranscriptStatus(item.status),
    sourceAgentKind: item.sourceAgentKind ?? "unknown",
    isTransient: false,
    messageId: readString(payloadItem?.messageId),
    title: cleanedProjectedTitle(item.title, item.kind),
    nativeToolName: readString(payloadItem?.nativeToolName),
    parentToolCallId: readString(payloadItem?.parentToolCallId),
    rawInput: payloadItem?.rawInput,
    rawOutput: payloadItem?.rawOutput,
    contentParts,
    timestamp: item.firstEventAt ?? item.lastEventAt ?? "1970-01-01T00:00:00.000Z",
    startedSeq: item.firstSeq,
    lastUpdatedSeq: item.lastSeq,
    completedSeq: item.completedSeq ?? (item.status === "in_progress" ? null : item.lastSeq),
    completedAt: item.status === "in_progress" ? null : item.lastEventAt ?? item.firstEventAt ?? null,
  };

  switch (item.kind) {
    case "user_message":
    case "prompt":
      return {
        ...base,
        kind: "user_message",
        text,
        isStreaming: item.status === "in_progress",
        promptId: projectedItemPromptId(item),
        promptProvenance: null,
      };
    case "assistant_message":
    case "assistant_prose":
      return {
        ...base,
        kind: "assistant_prose",
        text,
        isStreaming: item.status === "in_progress",
      };
    case "reasoning":
    case "thought":
      return {
        ...base,
        kind: "thought",
        text,
        isStreaming: item.status === "in_progress",
      };
    case "tool":
    case "tool_call":
    case "tool_invocation":
      return {
        ...base,
        kind: "tool_call",
        toolCallId: projectedItemToolCallId(item),
        toolKind: readString(payloadItem?.toolKind) ?? (projectedItemLooksLikeShellTool(item) ? "execute" : "other"),
        semanticKind: projectedItemLooksLikeShellTool(item) ? "terminal" : "other",
        approvalState: "none",
      };
    case "plan": {
      const planPart = contentParts.find((part): part is Extract<ContentPart, { type: "plan" }> =>
        part.type === "plan"
      );
      return {
        ...base,
        kind: "plan",
        entries: planPart?.entries ?? [],
      };
    }
    case "proposed_plan": {
      const plan = contentParts.find(
        (part): part is Extract<ContentPart, { type: "proposed_plan" }> =>
          part.type === "proposed_plan",
      );
      if (!plan) {
        return {
          ...base,
          kind: "assistant_prose",
          text,
          isStreaming: item.status === "in_progress",
        };
      }
      return {
        ...base,
        kind: "proposed_plan",
        plan,
        decision: contentParts.find(
          (part): part is Extract<ContentPart, { type: "proposed_plan_decision" }> =>
            part.type === "proposed_plan_decision" && part.planId === plan.planId,
        ) ?? null,
      };
    }
    case "error":
    case "error_item":
      return {
        ...base,
        kind: "error",
        message: text || item.title || "Error",
        code: null,
        details: null,
      };
    default:
      return {
        kind: "unknown",
        itemId: item.itemId,
        turnId,
        eventType: item.kind ?? "projection_item",
        rawPayload: item.payload,
        timestamp: item.firstEventAt ?? item.lastEventAt ?? "1970-01-01T00:00:00.000Z",
        startedSeq: item.firstSeq,
      };
  }
}

function projectedContentParts(
  item: CloudTranscriptItem,
  payloadItem: Record<string, unknown> | null,
): ContentPart[] {
  const payloadParts = payloadItem?.contentParts;
  if (Array.isArray(payloadParts)) {
    return payloadParts.filter(isRecord) as ContentPart[];
  }
  const text = item.text ?? projectedPayloadText(item.payload) ?? "";
  if (!text) {
    return [];
  }
  if (item.kind === "reasoning" || item.kind === "thought") {
    return [{ type: "reasoning", text, visibility: "private" }];
  }
  if (item.kind === "tool" || item.kind === "tool_call" || item.kind === "tool_invocation") {
    return [{ type: "tool_result_text", text }] as ContentPart[];
  }
  return [{ type: "text", text }] as ContentPart[];
}

function projectedTranscriptStatus(status: string | null | undefined): TranscriptItemStatus {
  if (status === "failed") {
    return "failed";
  }
  if (status === "in_progress" || status === "running" || status === "streaming") {
    return "in_progress";
  }
  return "completed";
}

function cleanedProjectedTitle(
  title: string | null | undefined,
  itemKind: string | null | undefined,
): string | null {
  const value = title?.trim();
  if (!value || value === itemKind) {
    return null;
  }
  return value;
}
