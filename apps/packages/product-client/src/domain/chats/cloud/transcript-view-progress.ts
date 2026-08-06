import type { CloudTranscriptItem } from "@proliferate/cloud-sdk";
import type {
  CloudChatTranscriptRowView,
  CloudOptimisticPromptReference,
} from "./transcript-view-model";
import {
  latestProjectedItemSeq,
} from "./transcript-view-projected-items";
import {
  isPromptTranscriptKind,
  latestTranscriptRowSeq,
  rowIsAfterPromptBaseline,
  textMatches,
} from "./transcript-view-utils";

export function cloudTranscriptHasUserPrompt(input: {
  prompt: CloudOptimisticPromptReference;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  allowTextOnlyRowFallback?: boolean;
}): boolean {
  return input.transcriptItems.some((item) =>
    isPromptItemForOptimisticPrompt(item, input.prompt)
  )
    || input.transcriptRows.some((row) =>
      row.kind === "user"
      && rowIsAfterPromptBaseline(row, input.prompt)
      && textMatches(row.body, input.prompt.text)
    )
    || (
      input.allowTextOnlyRowFallback === true
      && input.transcriptItems.length === 0
      && input.transcriptRows.some((row) =>
        row.kind === "user" && textMatches(row.body, input.prompt.text)
      )
    );
}

export function cloudTranscriptHasAgentProgressAfterPrompt(input: {
  prompt: CloudOptimisticPromptReference;
  transcriptItems: readonly CloudTranscriptItem[];
  transcriptRows: readonly CloudChatTranscriptRowView[];
  allowTextOnlyRowFallback?: boolean;
}): boolean {
  const promptItem = [...input.transcriptItems]
    .filter((item) => isPromptItemForOptimisticPrompt(item, input.prompt))
    .sort((left, right) => right.lastSeq - left.lastSeq)[0];
  if (promptItem) {
    return input.transcriptItems.some((item) =>
      item.firstSeq > promptItem.lastSeq && !isPromptTranscriptKind(item.kind)
    )
      || input.transcriptRows.some((row) =>
        row.kind !== "user"
        && typeof row.firstSeq === "number"
        && row.firstSeq > promptItem.lastSeq
      );
  }

  const promptRowIndex = input.transcriptRows.findIndex((row) =>
    row.kind === "user"
    && rowIsAfterPromptBaseline(row, input.prompt)
    && textMatches(row.body, input.prompt.text)
  );
  const fallbackPromptRowIndex = input.allowTextOnlyRowFallback === true
    ? input.transcriptRows.findIndex((row) =>
      row.kind === "user" && textMatches(row.body, input.prompt.text)
    )
    : -1;
  const resolvedPromptRowIndex = promptRowIndex === -1 ? fallbackPromptRowIndex : promptRowIndex;
  if (resolvedPromptRowIndex === -1) {
    return false;
  }
  return input.transcriptRows
    .slice(resolvedPromptRowIndex + 1)
    .some((row) => row.kind !== "user" && rowIsAfterPromptBaseline(row, input.prompt));
}

export function latestCloudTranscriptSeq(
  items: readonly CloudTranscriptItem[],
  rows: readonly CloudChatTranscriptRowView[],
): number {
  return Math.max(latestProjectedItemSeq(items), latestTranscriptRowSeq(rows));
}

function isPromptItemForOptimisticPrompt(
  item: CloudTranscriptItem,
  prompt: CloudOptimisticPromptReference,
): boolean {
  return item.firstSeq > prompt.baseTranscriptSeq
    && isPromptTranscriptKind(item.kind)
    && textMatches(item.text, prompt.text);
}
