import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { CHAT_SCROLL_BASE_BOTTOM_PADDING_PX } from "@/config/chat-layout";
import { useWorkspaceFileActions } from "@/hooks/workspaces/facade/files/use-workspace-file-actions";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";
import { useOpenCoworkArtifact } from "@/hooks/cowork/workflows/use-open-cowork-artifact";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { usePromptOutboxActions } from "@/hooks/chat/workflows/use-prompt-outbox-actions";
import { useTypingActivityStore } from "@/lib/infra/interaction/typing-activity-store";
import type { TranscriptOpenSessionRole } from "@proliferate/product-domain/chats/transcript/transcript-open-target";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";
import {
  ChatTranscriptView,
  type ChatTranscriptGoalEventRenderInput,
  type ChatTranscriptPendingPromptRenderInput,
  type ChatTranscriptPendingStatusInput,
  type ChatTranscriptTurnRowRenderInput,
  type ChatTranscriptTurnStatusInput,
} from "@proliferate/product-ui/chat/transcript/ChatTranscriptView";
import type { ChatTranscriptState } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { collectToolCallIdsWithProposedPlan } from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import { TranscriptContextProviders, type TranscriptOpenSessionHandler } from "./TranscriptContexts";
import { ProposedPlanToolCallIdsProvider } from "./ProposedPlanToolCallIdsContext";
import { GoalTranscriptEventRow } from "./GoalTranscriptEventRow";
import { TranscriptPendingPromptRow } from "./TranscriptPendingPromptRow";
import { TranscriptTurnRow } from "./TranscriptTurnRow";

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
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  olderHistoryCursor?: number | null;
  bottomInsetPx?: number;
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
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  olderHistoryCursor = null,
  bottomInsetPx = CHAT_SCROLL_BASE_BOTTOM_PADDING_PX,
  onLoadOlderHistory,
  onHandOffPlanToNewSession,
  onOpenSession,
  canOpenSession,
}: MessageListProps) {
  useDebugRenderCount("transcript-list");
  const scrollSampleOperationRef = useRef<MeasurementOperationId | null>(null);
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
    history: {
      hasOlderHistory,
      isLoadingOlderHistory,
      olderHistoryCursor,
      onLoadOlderHistory,
    },
    layout: {
      bottomInsetPx,
    },
  }), [
    activeSessionId,
    bottomInsetPx,
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
  ]);
  const deferredTranscriptViewState = useDeferredValue(transcriptViewState);
  const typingActive = useTypingActivityStore((state) => state.typingActive);
  const effectiveTranscriptViewState = typingActive
    ? deferredTranscriptViewState
    : transcriptViewState;

  // Transcript-wide ExitPlanMode suppression index (the plan-doubling fix):
  // a proposed_plan item can land in a different turn than the ExitPlanMode
  // tool call that opened it, so the suppression set MUST span the whole
  // transcript — not a single turn's blocks. Derived once here and threaded
  // to every turn row via context. Keyed off the effective (deferred while
  // typing) transcript so it stays consistent with what the rows render.
  const proposedPlanToolCallIds = useMemo(
    () => collectToolCallIdsWithProposedPlan(effectiveTranscriptViewState.transcript),
    [effectiveTranscriptViewState.transcript],
  );

  const handleTranscriptScroll = useCallback((sample?: { programmatic: boolean }) => {
    // Tag the scroll source: a persistent stream of `source.programmatic`
    // samples (with no user input) means a stick-to-bottom snap / virtualizer
    // measurement feedback loop — the difference between "user scrolled" and
    // "we are scrolling ourselves in circles".
    recordMeasurementMetric({
      type: "diagnostic",
      category: "transcript_scroll",
      label: sample === undefined
        ? "source.unknown"
        : sample.programmatic
          ? "source.programmatic"
          : "source.user",
      count: 1,
    });
    const operationId = startMeasurementOperation({
      kind: "transcript_scroll",
      sampleKey: "transcript",
      surfaces: [
        "transcript-list",
        "transcript-context-providers",
        "transcript-row-list-router",
        "transcript-virtualized-viewport",
        "transcript-full-list",
        "session-transcript-pane",
        "chat-surface",
      ],
      idleTimeoutMs: 750,
      maxDurationMs: 8000,
      cooldownMs: 1500,
    });
    if (operationId) {
      scrollSampleOperationRef.current = operationId;
      markOperationForNextCommit(operationId, [
        "transcript-list",
        "transcript-context-providers",
        "transcript-row-list-router",
        "transcript-virtualized-viewport",
        "transcript-full-list",
        "session-transcript-pane",
        "chat-surface",
      ]);
    }
  }, []);

  useEffect(() => () => {
    finishOrCancelMeasurementOperation(scrollSampleOperationRef.current, "unmount");
    scrollSampleOperationRef.current = null;
  }, []);

  const renderPendingPromptRow = useCallback((input: ChatTranscriptPendingPromptRenderInput) => (
    <TranscriptPendingPromptRow
      activeSessionId={input.activeSessionId}
      rowIndex={input.rowIndex}
      prompt={input.prompt}
      outboxEntry={input.outboxEntry}
      optimisticTrailingStatus={input.optimisticTrailingStatus}
      outboxActions={input.outboxActions}
    />
  ), []);

  const renderTurnRow = useCallback((input: ChatTranscriptTurnRowRenderInput) => (
    <TranscriptTurnRow
      row={input.row}
      rowIndex={input.rowIndex}
      turn={input.turn}
      transcript={input.transcript}
      latestTurnId={input.latestTurnId}
      latestLiveExplorationBlock={input.latestLiveExplorationBlock}
      latestLiveStatus={input.latestLiveStatus}
      outboxStartedAtByPromptId={input.outboxStartedAtByPromptId}
      selectedWorkspaceId={input.selectedWorkspaceId}
      sessionViewState={input.sessionViewState}
      onOpenFile={(filePath) => void openFile(filePath)}
      onOpenTurnChanges={() => openGitReviewPane({ mode: "last_turn" })}
      onOpenArtifact={openArtifact}
      onHandOffPlanToNewSession={onHandOffPlanToNewSession}
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
              />
            </DebugProfiler>
          </ProposedPlanToolCallIdsProvider>
        </TranscriptContextProviders>
      </DebugProfiler>
    </DebugProfiler>
  );
}
