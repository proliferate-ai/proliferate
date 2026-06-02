import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "./transcript-view-model";
import {
  isRecord,
  isSessionEventEnvelope,
  readString,
} from "./transcript-view-utils";
import {
  normalizeProjectedShellTitle,
} from "./transcript-view-projected-items";
import { appendPendingPromptRows } from "./transcript-view-pending-prompts";

export function cloudPendingInteractionsRequireProjectedRows(
  pendingInteractions: readonly CloudPendingInteraction[],
): boolean {
  return pendingInteractions.some((interaction) =>
    interaction.status === "pending" && interaction.kind !== "send_prompt"
  );
}

export function applyInteractionCommandDetails(
  rows: readonly CloudChatTranscriptRowView[],
  events: readonly CloudSessionEvent[],
): CloudChatTranscriptRowView[] {
  const commandsByToolCallId = interactionCommandTitlesByToolCallId(events);
  if (commandsByToolCallId.size === 0) {
    return [...rows];
  }
  return rows.map((row) => applyInteractionCommandDetailsToRow(row, commandsByToolCallId));
}

export function applyPendingInteractionRows(
  rows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
  projectedItems: readonly CloudTranscriptItem[] = [],
): CloudChatTranscriptRowView[] {
  const rowsWithPermissions = applyPendingPermissionRows(rows, pendingInteractions);
  return appendPendingPromptRows(rowsWithPermissions, pendingInteractions, projectedItems);
}

function applyInteractionCommandDetailsToRow(
  row: CloudChatTranscriptRowView,
  commandsByToolCallId: ReadonlyMap<string, string>,
): CloudChatTranscriptRowView {
  const children = row.children?.map((child) =>
    applyInteractionCommandDetailsToRow(child, commandsByToolCallId)
  );
  const command = row.sourceToolCallId
    ? commandsByToolCallId.get(row.sourceToolCallId)
    : null;
  if (!command) {
    return children ? { ...row, children } : row;
  }
  return {
    ...row,
    title: row.kind === "tool" ? "Command" : row.title,
    detail: command,
    children,
  };
}

function interactionCommandTitlesByToolCallId(
  events: readonly CloudSessionEvent[],
): Map<string, string> {
  const commands = new Map<string, string>();
  for (const event of events) {
    const envelope = event.envelope;
    if (!isSessionEventEnvelope(envelope)) {
      continue;
    }
    const eventPayload = envelope.event;
    if (!isRecord(eventPayload) || eventPayload.type !== "interaction_requested") {
      continue;
    }
    const title = normalizeProjectedShellTitle(readString(eventPayload.title));
    if (!title) {
      continue;
    }
    const source = isRecord(eventPayload.source)
      ? eventPayload.source as Record<string, unknown>
      : null;
    const toolCallId = readString(source?.toolCallId)
      ?? readString(source?.["tool_call_id"])
      ?? null;
    if (toolCallId) {
      commands.set(toolCallId, title);
    }
  }
  return commands;
}

interface PendingPermissionRowInfo {
  interaction: CloudPendingInteraction;
  title: string;
  description: string | null;
  toolCallId: string | null;
  itemId: string | null;
}

function applyPendingPermissionRows(
  rows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
): CloudChatTranscriptRowView[] {
  const permissions = pendingInteractions
    .map(pendingPermissionRowInfo)
    .filter((info): info is PendingPermissionRowInfo => info !== null);
  if (permissions.length === 0) {
    return markStaleRunningToolRows(rows);
  }

  const unmatched = new Map(
    permissions.map((info) => [info.interaction.requestId, info]),
  );
  const annotatedRows = rows.map((row) => {
    const match = permissions.find((info) => pendingPermissionMatchesRow(info, row));
    if (!match) {
      return row;
    }
    unmatched.delete(match.interaction.requestId);
    return {
      ...row,
      detail: match.title || row.detail,
      body: row.body ?? match.description,
      status: pendingPermissionStatusLabel(match.interaction),
      sourceRequestId: match.interaction.requestId,
      sourceToolCallId: match.toolCallId ?? row.sourceToolCallId ?? null,
    };
  });

  const pendingRows = [...unmatched.values()]
    .sort((left, right) => left.interaction.requestedSeq - right.interaction.requestedSeq)
    .map((info): CloudChatTranscriptRowView => ({
      id: `pending-permission:${info.interaction.requestId}`,
      kind: "tool",
      title: "Command",
      body: info.description,
      detail: info.title,
      status: pendingPermissionStatusLabel(info.interaction),
      firstSeq: info.interaction.requestedSeq,
      lastSeq: info.interaction.requestedSeq,
      sourceRequestId: info.interaction.requestId,
      sourceToolCallId: info.toolCallId,
    }));

  const settledRows = markStaleRunningToolRows(annotatedRows);
  return pendingRows.length === 0 ? settledRows : [...settledRows, ...pendingRows];
}

function markStaleRunningToolRows(
  rows: readonly CloudChatTranscriptRowView[],
): CloudChatTranscriptRowView[] {
  return rows.map((row, index) => {
    if (!isRunningToolRow(row)) {
      return row;
    }
    const rowSeq = row.lastSeq ?? row.firstSeq;
    if (typeof rowSeq !== "number") {
      return row;
    }
    const laterTranscriptProgress = rows.slice(index + 1).some((laterRow) =>
      laterRow.kind !== "system"
      && typeof laterRow.firstSeq === "number"
      && laterRow.firstSeq > rowSeq
    );
    return laterTranscriptProgress ? { ...row, status: "Interrupted" } : row;
  });
}

function isRunningToolRow(row: CloudChatTranscriptRowView): boolean {
  if (row.kind !== "tool" && row.kind !== "tool_group") {
    return false;
  }
  const status = row.status?.toLowerCase();
  return status === "in progress" || status === "in_progress" || status === "running";
}

function pendingPermissionRowInfo(
  interaction: CloudPendingInteraction,
): PendingPermissionRowInfo | null {
  if (
    interaction.kind !== "permission"
    || (interaction.status !== "pending" && interaction.status !== "failed")
  ) {
    return null;
  }
  const payload = interaction.payload;
  const event = isRecord(payload?.event) ? payload.event : null;
  const source = event && isRecord(event.source) ? event.source : null;
  const title = interaction.title?.trim()
    || readString(event?.title)?.trim()
    || "Permission request";
  const description = interaction.description?.trim() || null;
  const toolCallId = readString(source?.toolCallId)
    ?? readString(payload?.itemId)
    ?? null;
  const itemId = readString(payload?.itemId) ?? toolCallId;
  return {
    interaction,
    title,
    description,
    toolCallId,
    itemId,
  };
}

function pendingPermissionMatchesRow(
  info: PendingPermissionRowInfo,
  row: CloudChatTranscriptRowView,
): boolean {
  if (row.kind !== "tool" && row.kind !== "tool_group") {
    return false;
  }
  if (info.toolCallId && row.sourceToolCallId === info.toolCallId) {
    return true;
  }
  if (info.itemId && row.id.includes(info.itemId)) {
    return true;
  }
  return false;
}

function pendingPermissionStatusLabel(interaction: CloudPendingInteraction): string {
  return interaction.status === "failed" ? "Approval failed" : "Needs approval";
}
