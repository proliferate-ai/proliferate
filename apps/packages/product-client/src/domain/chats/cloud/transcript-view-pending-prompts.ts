import type {
  CloudPendingInteraction,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "./transcript-view-model";
import { projectedItemPromptId } from "./transcript-view-projected-items";
import {
  isPromptTranscriptKind,
  readString,
  rowIsAfterSeq,
  textMatches,
} from "./transcript-view-utils";

export function appendPendingPromptRows(
  rows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
  projectedItems: readonly CloudTranscriptItem[] = [],
): CloudChatTranscriptRowView[] {
  const pendingRows = buildRowsFromPendingPromptInteractions(
    rows,
    pendingInteractions,
    projectedItems,
  );
  return pendingRows.length === 0 ? [...rows] : [...rows, ...pendingRows];
}

function buildRowsFromPendingPromptInteractions(
  existingRows: readonly CloudChatTranscriptRowView[],
  pendingInteractions: readonly CloudPendingInteraction[],
  projectedItems: readonly CloudTranscriptItem[],
): CloudChatTranscriptRowView[] {
  const rows: CloudChatTranscriptRowView[] = [];
  for (const interaction of pendingInteractions) {
    if (
      (interaction.status !== "pending" && interaction.status !== "failed")
      || interaction.kind !== "send_prompt"
    ) {
      continue;
    }
    const text = pendingPromptText(interaction);
    const commandId = pendingPromptCommandId(interaction);
    if (!text) {
      continue;
    }
    const promptItem = projectedPromptItemForPendingInteraction(
      projectedItems,
      interaction,
      text,
    );
    const promptRowIndex = findLastMatchingUserRowIndex(existingRows, interaction, text);
    const promptVisible = promptItem !== null
      || promptRowIndex !== -1;
    const agentProgressVisible = promptItem
      ? projectedAgentProgressAfterPrompt(projectedItems, promptItem)
      : promptRowIndex !== -1
        ? rowHasAgentProgressAfter(existingRows, promptRowIndex)
        : rowsHaveAgentProgressAfterSeq(existingRows, interaction.requestedSeq);
    const failed = interaction.status === "failed";
    if (!promptVisible) {
      rows.push({
        id: `pending-prompt:${interaction.requestId}:user`,
        kind: "user",
        body: text,
        status: failed ? "Failed" : "Queued",
        streaming: !failed,
        sourceRequestId: interaction.requestId,
        sourceCommandId: commandId,
      });
    }
    if (!failed && agentProgressVisible) {
      continue;
    }
    rows.push({
      id: `pending-prompt:${interaction.requestId}:assistant-waiting`,
      kind: failed ? "error" : "assistant",
      body: failed
        ? interaction.description
          ?? "Prompt could not be delivered."
        : null,
      detail: failed ? null : interaction.description ?? "Waiting for response.",
      streaming: !failed,
      sourceRequestId: interaction.requestId,
      sourceCommandId: commandId,
    });
  }
  return rows;
}

function pendingPromptText(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const text = readString(payload.text)
    ?? readString(payload.prompt)
    ?? readString(payload.message)
    ?? readString(payload.content);
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

function pendingPromptCommandId(interaction: CloudPendingInteraction): string | null {
  const payload = interaction.payload;
  if (!payload) {
    return null;
  }
  const commandId = payload.commandId;
  return typeof commandId === "string" && commandId.trim() ? commandId.trim() : null;
}

function projectedPromptItemForPendingInteraction(
  items: readonly CloudTranscriptItem[],
  interaction: CloudPendingInteraction,
  text: string,
): CloudTranscriptItem | null {
  return [...items]
    .filter((item) =>
      isPromptTranscriptKind(item.kind)
      && (
        projectedItemPromptId(item) === interaction.requestId
        || (
          item.firstSeq > interaction.requestedSeq
          && textMatches(item.text, text)
        )
      )
    )
    .sort((left, right) => right.lastSeq - left.lastSeq)[0] ?? null;
}

function projectedAgentProgressAfterPrompt(
  items: readonly CloudTranscriptItem[],
  promptItem: CloudTranscriptItem,
): boolean {
  return items.some((item) =>
    item.firstSeq > promptItem.lastSeq && !isPromptTranscriptKind(item.kind)
  );
}

function findLastMatchingUserRowIndex(
  rows: readonly CloudChatTranscriptRowView[],
  interaction: CloudPendingInteraction,
  text: string,
): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row.kind === "user"
      && (
        row.sourceRequestId === interaction.requestId
        || (
          rowIsAfterSeq(row, interaction.requestedSeq)
          && textMatches(row.body, text)
        )
      )
    ) {
      return index;
    }
  }
  return -1;
}

function rowHasAgentProgressAfter(
  rows: readonly CloudChatTranscriptRowView[],
  promptRowIndex: number,
): boolean {
  const promptRow = rows[promptRowIndex];
  const promptSeq = promptRow.lastSeq ?? promptRow.firstSeq ?? null;
  return rows.slice(promptRowIndex + 1).some((row) =>
    row.kind !== "user"
    && row.kind !== "system"
    && (
      typeof promptSeq !== "number"
      || typeof row.firstSeq !== "number"
      || row.firstSeq > promptSeq
    )
  );
}

function rowsHaveAgentProgressAfterSeq(
  rows: readonly CloudChatTranscriptRowView[],
  seq: number,
): boolean {
  return rows.some((row) =>
    row.kind !== "user"
    && row.kind !== "system"
    && rowIsAfterSeq(row, seq)
  );
}
