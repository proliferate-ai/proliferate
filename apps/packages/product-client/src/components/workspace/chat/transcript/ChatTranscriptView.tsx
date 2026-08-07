import { useRef } from "react";
import type {
  ChatTranscriptOutboxActions,
  ChatTranscriptViewProps,
} from "#product/hooks/chat/ui/chat-transcript-view-types";
import { ChatTranscriptRows } from "./ChatTranscriptRows";
import { ChatContentSearchQueryContext } from "./ChatContentSearchContext";
import { useChatTranscriptCopySelection } from "#product/hooks/chat/ui/use-chat-transcript-copy-selection";
import { useChatTranscriptRowRenderer } from "#product/hooks/chat/ui/use-chat-transcript-row-renderer";
import { useChatTranscriptViewModel } from "#product/hooks/chat/ui/use-chat-transcript-view-model";

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
  renderGoalEventRow,
  contentSearch,
  scrollHandleRef,
}: ChatTranscriptViewProps) {
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const searchQuery = contentSearch?.query.trim() ? contentSearch.query.trim() : null;
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

  const {
    renderRow: renderVirtualRow,
    getRowRenderRevision,
  } = useChatTranscriptRowRenderer({
    activeSessionId: model.activeSessionId,
    latestLiveExplorationBlock: model.latestLiveExplorationBlock,
    latestLiveStatus: model.latestLiveStatus,
    latestCompletedTurnId: model.latestCompletedTurnId,
    latestTurnId: model.latestTurnId,
    optimisticPromptTrailingStatus: model.optimisticPromptTrailingStatus,
    outboxActions,
    outboxStartedAtByPromptId: model.outboxStartedAtByPromptId,
    renderPendingPromptRow,
    renderTurnRow,
    renderGoalEventRow,
    selectedWorkspaceId: model.selectedWorkspaceId,
    sessionViewState: model.sessionViewState,
    transcript: model.transcript,
    visibleOutboxEntries: model.visibleOutboxEntries,
    visibleOptimisticPrompt: model.visibleOptimisticPrompt,
  });

  return (
    <ChatContentSearchQueryContext.Provider value={searchQuery}>
      <ChatTranscriptRows
        rowListKey={`${model.selectedWorkspaceId ?? "workspace"}:${model.activeSessionId}`}
        rows={model.virtualRows}
        selectionRootRef={selectionRootRef}
        hasOlderHistory={model.hasOlderHistory}
        isLoadingOlderHistory={model.isLoadingOlderHistory}
        olderHistoryCursor={model.olderHistoryCursor}
        bottomInsetPx={model.bottomInsetPx}
        nonDisplacingBottomInsetPx={model.nonDisplacingBottomInsetPx}
        selectedWorkspaceId={model.selectedWorkspaceId}
        activeSessionId={model.activeSessionId}
        isSessionBusy={
          model.sessionViewState === "working" || model.sessionViewState === "needs_input"
        }
        pendingPromptText={model.visibleOptimisticPrompt?.text ?? null}
        onLoadOlderHistory={model.onLoadOlderHistory}
        onScrollSample={onScrollSample}
        renderRow={renderVirtualRow}
        getRowRenderRevision={getRowRenderRevision}
        columnClassName={model.columnClassName}
        gutterClassName={model.gutterClassName}
        scrollHandleRef={scrollHandleRef}
      />
    </ChatContentSearchQueryContext.Provider>
  );
}
