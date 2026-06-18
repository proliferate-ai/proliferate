import { useRef } from "react";
import type {
  ChatTranscriptOutboxActions,
  ChatTranscriptViewProps,
} from "./ChatTranscriptViewTypes";
import { ChatTranscriptRows } from "./ChatTranscriptRows";
import { useChatTranscriptCopySelection } from "./useChatTranscriptCopySelection";
import { useChatTranscriptRowRenderer } from "./useChatTranscriptRowRenderer";
import { useChatTranscriptViewModel } from "./useChatTranscriptViewModel";

export type {
  ChatTranscriptOutboxActions,
  ChatTranscriptPendingPromptRenderInput,
  ChatTranscriptPendingStatusInput,
  ChatTranscriptTurnRowRenderInput,
  ChatTranscriptTurnStatusInput,
  ChatTranscriptViewProps,
} from "./ChatTranscriptViewTypes";

const noop = () => {};
const NOOP_OUTBOX_ACTIONS: ChatTranscriptOutboxActions = {
  retryPrompt: noop,
  dismissPrompt: noop,
};

export function ChatTranscriptView({
  state,
  outboxActions = NOOP_OUTBOX_ACTIONS,
  onScrollSample = noop,
  renderPendingPromptRow,
  renderTurnRow,
  renderPendingPromptTrailingStatus,
  renderTurnTrailingStatus,
}: ChatTranscriptViewProps) {
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const model = useChatTranscriptViewModel({
    state,
    renderPendingPromptTrailingStatus,
    renderTurnTrailingStatus,
  });

  useChatTranscriptCopySelection({
    selectionRootRef,
    transcript: model.transcript,
    visibleTurnIds: model.visibleTurnIds,
    visibleOptimisticPrompt: model.visibleOptimisticPrompt,
  });

  const renderVirtualRow = useChatTranscriptRowRenderer({
    activeSessionId: model.activeSessionId,
    latestLiveExplorationBlock: model.latestLiveExplorationBlock,
    latestLiveStatus: model.latestLiveStatus,
    latestTurnId: model.latestTurnId,
    optimisticPromptTrailingStatus: model.optimisticPromptTrailingStatus,
    outboxActions,
    outboxStartedAtByPromptId: model.outboxStartedAtByPromptId,
    renderPendingPromptRow,
    renderTurnRow,
    selectedWorkspaceId: model.selectedWorkspaceId,
    sessionViewState: model.sessionViewState,
    transcript: model.transcript,
    visibleOutboxEntries: model.visibleOutboxEntries,
    visibleOptimisticPrompt: model.visibleOptimisticPrompt,
  });

  return (
    <ChatTranscriptRows
      rows={model.virtualRows}
      selectionRootRef={selectionRootRef}
      hasOlderHistory={model.hasOlderHistory}
      isLoadingOlderHistory={model.isLoadingOlderHistory}
      olderHistoryCursor={model.olderHistoryCursor}
      bottomInsetPx={model.bottomInsetPx}
      selectedWorkspaceId={model.selectedWorkspaceId}
      activeSessionId={model.activeSessionId}
      isSessionBusy={
        model.sessionViewState === "working" || model.sessionViewState === "needs_input"
      }
      pendingPromptText={model.visibleOptimisticPrompt?.text ?? null}
      onLoadOlderHistory={model.onLoadOlderHistory}
      onScrollSample={onScrollSample}
      renderRow={renderVirtualRow}
      columnClassName={model.columnClassName}
      gutterClassName={model.gutterClassName}
    />
  );
}
