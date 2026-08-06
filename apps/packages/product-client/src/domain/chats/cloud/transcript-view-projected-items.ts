import type { ContentPart } from "@anyharness/sdk";
import type { CloudTranscriptItem } from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "./transcript-view-model";
import {
  isRecord,
  previewText,
  readString,
} from "./transcript-view-utils";

export function latestProjectedItemSeq(items: readonly CloudTranscriptItem[]): number {
  return items.reduce(
    (maxSeq, item) => Math.max(maxSeq, item.lastSeq, item.completedSeq ?? 0),
    0,
  );
}

export function buildRowsFromProjectedItems(
  items: readonly CloudTranscriptItem[],
): CloudChatTranscriptRowView[] {
  return [...items]
    .sort((left, right) => left.firstSeq - right.firstSeq)
    .map((item): CloudChatTranscriptRowView => {
      const kind = projectedItemKind(item);
      const plan = kind === "proposed_plan" ? projectedItemProposedPlan(item) : null;
      const decision = plan ? projectedItemProposedPlanDecision(item, plan.planId) : null;
      return {
        id: `projection:${item.itemId}`,
        kind,
        title: projectedItemTitle(item, kind),
        body: previewText(item.text ?? projectedPayloadText(item.payload)),
        status: projectedItemStatus(item),
        detail: projectedItemDetail(item, kind),
        firstSeq: item.firstSeq,
        lastSeq: item.lastSeq,
        sourceRequestId: kind === "user" ? projectedItemPromptId(item) : null,
        sourceToolCallId: kind === "tool" ? projectedItemToolCallId(item) : null,
        planId: plan?.planId ?? null,
        planTitle: plan?.title ?? null,
        planBodyMarkdown: plan?.bodyMarkdown ?? null,
        planDecisionState: decision?.decisionState ?? null,
        planNativeResolutionState: decision?.nativeResolutionState ?? null,
        planDecisionVersion: decision?.decisionVersion ?? null,
        planErrorMessage: decision?.errorMessage ?? null,
        planNativeContinuation: Boolean(plan?.sourceToolCallId),
      };
    });
}

export function projectedPayloadText(payload: CloudTranscriptItem["payload"]): string | null {
  if (!payload) {
    return null;
  }
  const text = readString(payload.text)
    ?? readString(payload.message)
    ?? readString(payload.content)
    ?? readString(payload.output);
  return text ?? null;
}

export function projectedItemPromptId(item: CloudTranscriptItem): string | null {
  const payload = item.payload;
  if (!payload) {
    return null;
  }
  const directPromptId = readString(payload.promptId);
  if (directPromptId) {
    return directPromptId;
  }
  const event = payload.event;
  if (!isRecord(event)) {
    return null;
  }
  const eventItem = event.item;
  if (!isRecord(eventItem)) {
    return null;
  }
  return readString(eventItem.promptId);
}

export function projectedItemToolCallId(item: CloudTranscriptItem): string | null {
  const payload = item.payload;
  if (!payload) {
    return item.itemId;
  }
  const directToolCallId = readString(payload.toolCallId)
    ?? readString(payload.tool_call_id);
  if (directToolCallId) {
    return directToolCallId;
  }
  const event = payload.event;
  if (isRecord(event)) {
    const eventItem = event.item;
    if (isRecord(eventItem)) {
      const eventToolCallId = readString(eventItem.toolCallId)
        ?? readString(eventItem.tool_call_id);
      if (eventToolCallId) {
        return eventToolCallId;
      }
    }
    const source = event.source;
    if (isRecord(source)) {
      const sourceToolCallId = readString(source.toolCallId)
        ?? readString(source.tool_call_id);
      if (sourceToolCallId) {
        return sourceToolCallId;
      }
    }
  }
  return readString(payload.itemId) ?? item.itemId;
}

export function normalizeProjectedShellTitle(value: string | null | undefined): string | null {
  const title = value?.trim();
  if (!title) {
    return null;
  }
  const normalized = title.toLowerCase();
  if (
    normalized === "terminal"
    || normalized === "command"
    || normalized === "bash"
    || normalized === "shell"
    || normalized === "tool call"
  ) {
    return null;
  }
  return title;
}

export function projectedItemLooksLikeShellTool(item: CloudTranscriptItem): boolean {
  const payloadItem = projectedPayloadItem(item.payload);
  const values = [
    item.title,
    readString(payloadItem?.nativeToolName),
    readString(payloadItem?.toolKind),
    ...projectedToolCallContentParts(payloadItem).flatMap((part) => [
      readString(part.nativeToolName),
      readString(part.toolKind),
    ]),
  ];
  return values.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "bash"
      || normalized === "shell"
      || normalized === "terminal"
      || normalized === "execute";
  });
}

export function projectedPayloadItem(
  payload: CloudTranscriptItem["payload"],
): Record<string, unknown> | null {
  if (!payload) {
    return null;
  }
  const event = payload.event;
  if (!isRecord(event)) {
    return null;
  }
  return isRecord(event.item) ? event.item : null;
}

function projectedItemKind(item: CloudTranscriptItem): CloudChatTranscriptRowView["kind"] {
  switch (item.kind) {
    case "user_message":
    case "prompt":
      return "user";
    case "assistant_message":
    case "assistant_prose":
      return "assistant";
    case "proposed_plan":
      return "proposed_plan";
    case "reasoning":
    case "thought":
      return "thought";
    case "tool":
    case "tool_call":
    case "tool_invocation":
      return "tool";
    case "error":
    case "error_item":
      return "error";
    default:
      return "system";
  }
}

function projectedItemTitle(
  item: CloudTranscriptItem,
  kind: CloudChatTranscriptRowView["kind"],
): string | null {
  if (kind === "user" || kind === "assistant") {
    return null;
  }
  if (kind === "tool" && projectedItemLooksLikeShellTool(item)) {
    return "Command";
  }
  const title = cleanedProjectedTitle(item.title, item.kind);
  if (title) {
    return title;
  }
  switch (kind) {
    case "thought":
      return "Reasoning";
    case "tool":
    case "tool_group":
      return "Tool call";
    case "error":
      return "Error";
    case "system":
    default:
      return null;
  }
}

function projectedItemStatus(item: CloudTranscriptItem): string | null {
  const status = item.status?.trim();
  if (!status || status === "completed") {
    return null;
  }
  return status;
}

function projectedItemDetail(
  item: CloudTranscriptItem,
  kind: CloudChatTranscriptRowView["kind"],
): string | null {
  if (kind === "tool") {
    return projectedItemShellCommand(item);
  }
  return null;
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

function projectedItemProposedPlan(
  item: CloudTranscriptItem,
): Extract<ContentPart, { type: "proposed_plan" }> | null {
  const payloadItem = projectedPayloadItem(item.payload);
  const parts = payloadItem?.contentParts;
  if (!Array.isArray(parts)) {
    return null;
  }
  return parts.find((part): part is Extract<ContentPart, { type: "proposed_plan" }> =>
    isRecord(part) && part.type === "proposed_plan"
  ) ?? null;
}

function projectedItemProposedPlanDecision(
  item: CloudTranscriptItem,
  planId: string,
): Extract<ContentPart, { type: "proposed_plan_decision" }> | null {
  const payloadItem = projectedPayloadItem(item.payload);
  const parts = payloadItem?.contentParts;
  if (!Array.isArray(parts)) {
    return null;
  }
  return parts.find((part): part is Extract<ContentPart, { type: "proposed_plan_decision" }> =>
    isRecord(part)
    && part.type === "proposed_plan_decision"
    && part.planId === planId
  ) ?? null;
}

function projectedItemShellCommand(item: CloudTranscriptItem): string | null {
  if (!projectedItemLooksLikeShellTool(item)) {
    return null;
  }
  const payloadItem = projectedPayloadItem(item.payload);
  const titles = [
    item.title,
    readString(payloadItem?.title),
    ...projectedToolCallContentParts(payloadItem).map((part) => readString(part.title)),
  ];
  for (const title of titles) {
    const command = normalizeProjectedShellTitle(title);
    if (command) {
      return command;
    }
  }
  return null;
}

function projectedToolCallContentParts(
  payloadItem: Record<string, unknown> | null,
): Record<string, unknown>[] {
  const contentParts = payloadItem?.contentParts;
  if (!Array.isArray(contentParts)) {
    return [];
  }
  return contentParts.flatMap((part) => {
    const record = isRecord(part) ? part : null;
    return record?.type === "tool_call" ? [record] : [];
  });
}
