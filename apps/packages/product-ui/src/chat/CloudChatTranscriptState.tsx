import { useCallback, useMemo } from "react";
import {
  buildCloudTranscriptRowsFromTurnRow,
  type CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type { ChatTranscriptState } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import {
  ChatTranscriptView,
  type ChatTranscriptPendingPromptRenderInput,
  type ChatTranscriptTurnRowRenderInput,
} from "./transcript/ChatTranscriptView";
import {
  CloudChatTranscript,
  CloudChatTranscriptRows,
  type CloudChatTranscriptPlanActions,
} from "./CloudChatTranscript";

export type CloudChatTranscriptStateView = ChatTranscriptState;

export function CloudChatTranscriptState({
  view,
  emptyTitle,
  emptyDescription,
  pendingStatus = null,
  planActions,
}: {
  view: CloudChatTranscriptStateView;
  emptyTitle: string;
  emptyDescription?: string;
  pendingStatus?: string | null;
  planActions?: CloudChatTranscriptPlanActions;
}) {
  const transcriptViewState = useMemo<CloudChatTranscriptStateView>(() => ({
    ...view,
    layout: {
      bottomInsetPx: 32,
      columnClassName: "mx-auto w-full max-w-3xl",
      gutterClassName: "px-6",
      ...view.layout,
    },
  }), [view]);
  const renderPendingPromptRow = useCallback(
    (input: ChatTranscriptPendingPromptRenderInput) =>
      renderCloudPendingPromptRow(input, pendingStatus),
    [pendingStatus],
  );
  const renderTurnRow = useCallback(
    (input: ChatTranscriptTurnRowRenderInput) =>
      renderCloudTranscriptTurnRow(input, planActions),
    [planActions],
  );
  const renderPendingPromptTrailingStatus = useCallback(() => pendingStatus, [pendingStatus]);

  if (
    view.transcript.turnOrder.length === 0
    && !view.optimisticPrompt
    && (view.outboxEntries?.length ?? 0) === 0
  ) {
    return (
      <div className="web-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-6">
          <CloudChatTranscript
            rows={[]}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          />
        </div>
      </div>
    );
  }

  return (
    <ChatTranscriptView
      state={transcriptViewState}
      renderPendingPromptRow={renderPendingPromptRow}
      renderTurnRow={renderTurnRow}
      renderPendingPromptTrailingStatus={renderPendingPromptTrailingStatus}
    />
  );
}

function renderCloudPendingPromptRow(
  input: ChatTranscriptPendingPromptRenderInput,
  pendingStatus: string | null,
) {
  const rows = buildCloudPendingPromptRows(input.outboxEntry, input.prompt.text, pendingStatus);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className={input.rowIndex === 0 ? "pb-2" : "pt-2 pb-2"}>
      <CloudChatTranscriptRows rows={rows} />
    </div>
  );
}

function renderCloudTranscriptTurnRow(
  input: ChatTranscriptTurnRowRenderInput,
  planActions?: CloudChatTranscriptPlanActions,
) {
  const rows = buildCloudTranscriptRowsFromTurnRow({
    row: input.row,
    transcript: input.transcript,
  });
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className={input.rowIndex === 0 ? "pb-2" : "pt-2 pb-2"}>
      <CloudChatTranscriptRows rows={rows} planActions={planActions} />
    </div>
  );
}

function buildCloudPendingPromptRows(
  outboxEntry: PromptOutboxEntry | null,
  text: string,
  pendingStatus: string | null,
) {
  const failed = outboxEntry?.status === "failed"
    || outboxEntry?.deliveryState === "failed_before_dispatch";
  const loading = !failed;
  const rows: CloudChatTranscriptRowView[] = [
    {
      id: `${outboxEntry?.clientPromptId ?? "pending"}:user`,
      kind: "user" as const,
      body: text,
      status: failed ? "Failed" : loading ? "Loading" : null,
    },
  ];
  if (failed || loading) {
    rows.push({
      id: `${outboxEntry?.clientPromptId ?? "pending"}:assistant-waiting`,
      kind: failed ? "error" as const : "assistant" as const,
      body: failed ? outboxEntry?.errorMessage ?? pendingStatus ?? "Prompt could not be sent." : null,
      detail: failed ? null : pendingStatus ?? "Waiting for response.",
      streaming: !failed,
    });
  }
  return rows;
}
