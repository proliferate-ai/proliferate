import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { CHAT_SCROLL_BASE_BOTTOM_PADDING_PX } from "#product/config/chat-layout";
import { useWorkspaceFileActions } from "#product/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { useOpenCoworkArtifact } from "#product/hooks/cowork/workflows/use-open-cowork-artifact";
import type { PromptPlanAttachmentDescriptor } from "#product/domain/chats/composer/prompt-plan-attachments";
import type { PromptOutboxEntry } from "#product/domain/sessions/intents/session-intent-model";
import { usePromptOutboxActions } from "#product/hooks/chat/workflows/use-prompt-outbox-actions";
import { useTypingActivityStore } from "#product/lib/infra/interaction/typing-activity-store";
import type { TranscriptOpenSessionRole } from "#product/domain/chats/transcript/transcript-open-target";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "#product/domain/sessions/activity";
import type { GoalTranscriptEvent } from "#product/domain/activity/goal-transcript-events";
import {
  ChatTranscriptView,
} from "#product/components/workspace/chat/transcript/ChatTranscriptView";
import type {
  ChatTranscriptGoalEventRenderInput,
  ChatTranscriptPendingPromptRenderInput,
  ChatTranscriptPendingStatusInput,
  ChatTranscriptScrollHandle,
  ChatTranscriptTurnRowRenderInput,
  ChatTranscriptTurnStatusInput,
} from "#product/hooks/chat/ui/chat-transcript-view-types";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { useChatTranscriptContentSearch } from "#product/hooks/chat/lifecycle/use-chat-transcript-content-search";
import {
  chatRowKeyFromUnitId,
  parseChatRowMatchId,
  scrollActiveChatRowMatchIntoView,
} from "#product/lib/domain/content-search/chat-row-match-jump";
import type { ChatTranscriptState } from "#product/domain/chats/transcript/chat-transcript-state";
import { collectToolCallIdsWithProposedPlan } from "#product/domain/chats/transcript/transcript-rendering";
import {
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
} from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";
import { TranscriptContextProviders, type TranscriptOpenSessionHandler } from "#product/components/workspace/chat/transcript/TranscriptContexts";
import { ProposedPlanToolCallIdsProvider } from "#product/components/workspace/chat/transcript/ProposedPlanToolCallIdsContext";
import { GoalTranscriptEventRow } from "#product/components/workspace/chat/transcript/GoalTranscriptEventRow";
import { WorkspaceCreationReceipt } from "#product/components/workspace/chat/transcript/WorkspaceCreationReceipt";
import { TranscriptPendingPromptRow } from "#product/components/workspace/chat/transcript/TranscriptPendingPromptRow";
import { TranscriptTurnRow } from "#product/components/workspace/chat/transcript/TranscriptTurnRow";
import { TranscriptEntryMotionProvider } from "#product/components/workspace/chat/transcript/TranscriptEntryMotionContext";
import { TranscriptScrollPriorityProvider } from "#product/components/workspace/chat/transcript/TranscriptScrollPriorityContext";
import { useTranscriptScrollPriority } from "#product/hooks/chat/ui/use-transcript-scroll-priority";
import { useTranscriptScrollSample } from "#product/hooks/chat/ui/use-transcript-scroll-sample";

const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
const EMPTY_GOAL_EVENTS: readonly GoalTranscriptEvent[] = [];
type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

// INPUT-PRIORITY (the "typing must never be laggy" rule): WHILE THE USER IS
// TYPING, the transcript view renders from a DEFERRED copy of the view state,
// so keystrokes preempt stream-driven transcript re-renders and consecutive
// stream batches coalesce. When the user is NOT typing, the fresh copy renders
// urgently — deferring unconditionally starved the transcript while an agent
// streamed (each ~80-250ms batch restarted the in-flight deferred pass;
// measured 6.6s from prompt submit to first transcript commit), which read as
// "I sent a message and nothing happened".
const DeferredChatTranscriptView = memo(ChatTranscriptView);

interface MessageListProps {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  optimisticPrompt: PendingPromptEntry | null;
  outboxEntries?: readonly PromptOutboxEntry[];
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
  goalEvents?: readonly GoalTranscriptEvent[];
  workspaceReceiptKey?: string | null;
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  olderHistoryCursor?: number | null;
  bottomInsetPx?: number;
  nonDisplacingBottomInsetPx?: number;
  onLoadOlderHistory?: () => void;
  onHandOffPlanToNewSession?: PlanHandoffHandler;
  onOpenSession?: TranscriptOpenSessionHandler;
  canOpenSession?: (sessionId: string, role?: TranscriptOpenSessionRole) => boolean;
}

export function MessageList({
  activeSessionId,
  selectedWorkspaceId,
  optimisticPrompt,
  outboxEntries = EMPTY_OUTBOX_ENTRIES,
  transcript,
  sessionViewState,
  goalEvents = EMPTY_GOAL_EVENTS,
  workspaceReceiptKey = null,
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  olderHistoryCursor = null,
  bottomInsetPx = CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  nonDisplacingBottomInsetPx = 0,
  onLoadOlderHistory,
  onHandOffPlanToNewSession,
  onOpenSession,
  canOpenSession,
}: MessageListProps) {
  useDebugRenderCount("transcript-list");
  const {
    retryPrompt,
    dismissPrompt,
  } = usePromptOutboxActions();
  const outboxActions = useMemo(() => ({
    retryPrompt,
    dismissPrompt,
  }), [retryPrompt, dismissPrompt]);
  const { openFile, openGitReviewPane } = useWorkspaceFileActions();
  const { openArtifact } = useOpenCoworkArtifact();
  const transcriptViewState = useMemo<ChatTranscriptState>(() => ({
    activeSessionId,
    selectedWorkspaceId,
    optimisticPrompt,
    outboxEntries,
    transcript,
    sessionViewState,
    goalEvents,
    workspaceReceiptKey,
    history: {
      hasOlderHistory,
      isLoadingOlderHistory,
      olderHistoryCursor,
      onLoadOlderHistory,
    },
    layout: {
      bottomInsetPx,
      nonDisplacingBottomInsetPx,
    },
  }), [
    activeSessionId,
    bottomInsetPx,
    nonDisplacingBottomInsetPx,
    goalEvents,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryCursor,
    onLoadOlderHistory,
    optimisticPrompt,
    outboxEntries,
    selectedWorkspaceId,
    sessionViewState,
    transcript,
    workspaceReceiptKey,
  ]);
  const deferredTranscriptViewState = useDeferredValue(transcriptViewState);
  const typingActive = useTypingActivityStore((state) => state.typingActive);
  const typingPrioritizedTranscriptViewState = typingActive
    ? deferredTranscriptViewState
    : transcriptViewState;
  const {
    effectiveValue: effectiveTranscriptViewState,
    isUserScrolling,
    prioritizeScrollSample,
    registerSynchronousPause,
  } = useTranscriptScrollPriority({
    latestValue: typingPrioritizedTranscriptViewState,
    scopeKey: `${selectedWorkspaceId ?? "workspace"}:${activeSessionId}`,
  });

  // Chat content search (Cmd+F). The index hook owns match counts/navigation;
  // the paint prop + scroll handle drive highlighting and jump-to-match. All of
  // it is inert unless search is open on the chat surface.
  const contentSearchOpen = useContentSearchStore((state) => state.open);
  const contentSearchSurface = useContentSearchStore((state) => state.surface);
  const contentSearchQuery = useContentSearchStore((state) => state.query);
  const contentSearchActiveMatchId = useContentSearchStore((state) => state.activeMatchId);
  const chatSearchActive = contentSearchOpen && contentSearchSurface === "chat";
  const deferredContentSearchQuery = useDeferredValue(contentSearchQuery);
  const transcriptScrollHandleRef = useRef<ChatTranscriptScrollHandle | null>(null);

  useChatTranscriptContentSearch({
    transcript,
    activeSessionId,
    optimisticPrompt,
    outboxEntries,
    goalEvents,
  });

  const contentSearchPaint = useMemo(
    () =>
      chatSearchActive && deferredContentSearchQuery.trim().length > 0
        ? { query: deferredContentSearchQuery }
        : null,
    [chatSearchActive, deferredContentSearchQuery],
  );

  useEffect(() => {
    if (!chatSearchActive) {
      return;
    }
    const target = parseChatRowMatchId(contentSearchActiveMatchId);
    if (!target) {
      return;
    }
    transcriptScrollHandleRef.current?.scrollToRowKey(
      chatRowKeyFromUnitId(target.rowUnitId),
    );

    // First attempt synchronously — the target row is usually already mounted
    // (marks exist), so the active highlight lands in the same tick. The rAF
    // retries only cover the virtualized case where the row mounts after the
    // scroll above.
    if (scrollActiveChatRowMatchIntoView(target)) {
      return;
    }
    let frame = 0;
    let rafId = 0;
    const tick = () => {
      if (scrollActiveChatRowMatchIntoView(target)) {
        return;
      }
      frame += 1;
      if (frame <= 10) {
        rafId = window.requestAnimationFrame(tick);
      }
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [chatSearchActive, contentSearchActiveMatchId]);

  // Transcript-wide ExitPlanMode suppression index (the plan-doubling fix):
  // a proposed_plan item can land in a different turn than the ExitPlanMode
  // tool call that opened it, so the suppression set MUST span the whole
  // transcript — not a single turn's blocks. Derived once here and threaded
  // to every turn row via context. Keyed off the effective (deferred while
  // typing) transcript so it stays consistent with what the rows render.
  const proposedPlanToolCallIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousProposedPlanToolCallIds = proposedPlanToolCallIdsRef.current;
  const proposedPlanToolCallIds = useMemo(
    () => collectToolCallIdsWithProposedPlan(
      effectiveTranscriptViewState.transcript,
      previousProposedPlanToolCallIds,
    ),
    [effectiveTranscriptViewState.transcript, previousProposedPlanToolCallIds],
  );
  useLayoutEffect(() => {
    proposedPlanToolCallIdsRef.current = proposedPlanToolCallIds;
  }, [proposedPlanToolCallIds]);

  const handleTranscriptScroll = useTranscriptScrollSample(prioritizeScrollSample);

  const renderPendingPromptRow = useCallback((input: ChatTranscriptPendingPromptRenderInput) => (
    <TranscriptPendingPromptRow
      activeSessionId={input.activeSessionId}
      rowIndex={input.rowIndex}
      prompt={input.prompt}
      outboxEntry={input.outboxEntry}
      optimisticTrailingStatus={input.optimisticTrailingStatus}
      outboxActions={input.outboxActions}
      workspaceReceipt={input.row.hostsWorkspaceReceipt ? <WorkspaceCreationReceipt /> : null}
    />
  ), []);

  const renderTurnRow = useCallback((input: ChatTranscriptTurnRowRenderInput) => (
    <TranscriptTurnRow
      row={input.row}
      rowIndex={input.rowIndex}
      turn={input.turn}
      transcript={input.transcript}
      latestTurnId={input.latestTurnId}
      latestCompletedTurnId={input.latestCompletedTurnId}
      latestLiveExplorationBlock={input.latestLiveExplorationBlock}
      latestLiveStatus={input.latestLiveStatus}
      outboxStartedAtByPromptId={input.outboxStartedAtByPromptId}
      selectedWorkspaceId={input.selectedWorkspaceId}
      sessionViewState={input.sessionViewState}
      onOpenFile={(filePath) => void openFile(filePath)}
      onOpenTurnChanges={() => openGitReviewPane({ mode: "last_turn" })}
      onOpenArtifact={openArtifact}
      onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      workspaceReceipt={input.row.hostsWorkspaceReceipt ? <WorkspaceCreationReceipt /> : null}
    />
  ), [
    onHandOffPlanToNewSession,
    openArtifact,
    openFile,
    openGitReviewPane,
  ]);
  const renderGoalEventRow = useCallback((input: ChatTranscriptGoalEventRenderInput) => (
    <GoalTranscriptEventRow event={input.event} />
  ), []);
  // Stable renderer identities — required for DeferredChatTranscriptView's
  // memo to bail out on urgent (typing) passes.
  const renderPendingPromptTrailingStatusRow = useCallback(
    (input: ChatTranscriptPendingStatusInput) =>
      resolvePendingPromptTrailingStatus(
        input.queuedAt,
        input.sessionViewState,
        input.forceWorking,
      ),
    [],
  );
  const renderTurnTrailingStatusRow = useCallback(
    (input: ChatTranscriptTurnStatusInput) =>
      resolveTurnTrailingStatus(
        input.startedAt,
        input.sessionViewState,
        input.transientStatusText,
      ),
    [],
  );

  return (
    <DebugProfiler id="transcript-list">
      <DebugProfiler id="transcript-context-providers">
        <TranscriptContextProviders
          sessionId={activeSessionId}
          onOpenSession={onOpenSession}
          canOpenSession={canOpenSession}
        >
          <TranscriptScrollPriorityProvider
            isUserScrolling={isUserScrolling}
            registerSynchronousPause={registerSynchronousPause}
          >
            <TranscriptEntryMotionProvider
              key={`${effectiveTranscriptViewState.selectedWorkspaceId ?? "workspace"}:${effectiveTranscriptViewState.activeSessionId}`}
              transcript={effectiveTranscriptViewState.transcript}
            >
              <ProposedPlanToolCallIdsProvider value={proposedPlanToolCallIds}>
                <DebugProfiler id="transcript-row-list-router">
                  <DeferredChatTranscriptView
                    state={effectiveTranscriptViewState}
                    outboxActions={outboxActions}
                    onScrollSample={handleTranscriptScroll}
                    renderPendingPromptRow={renderPendingPromptRow}
                    renderTurnRow={renderTurnRow}
                    renderGoalEventRow={renderGoalEventRow}
                    renderPendingPromptTrailingStatus={renderPendingPromptTrailingStatusRow}
                    renderTurnTrailingStatus={renderTurnTrailingStatusRow}
                    contentSearch={contentSearchPaint}
                    scrollHandleRef={transcriptScrollHandleRef}
                  />
                </DebugProfiler>
              </ProposedPlanToolCallIdsProvider>
            </TranscriptEntryMotionProvider>
          </TranscriptScrollPriorityProvider>
        </TranscriptContextProviders>
      </DebugProfiler>
    </DebugProfiler>
  );
}
