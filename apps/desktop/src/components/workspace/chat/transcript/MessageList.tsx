import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { CHAT_SCROLL_BASE_BOTTOM_PADDING_PX } from "@/config/chat-layout";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useOpenCoworkArtifact } from "@/hooks/cowork/workflows/use-open-cowork-artifact";
import type { PromptPlanAttachmentDescriptor } from "@proliferate/product-domain/chats/composer/prompt-plan-attachments";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import { usePromptOutboxActions } from "@/hooks/chat/workflows/use-prompt-outbox-actions";
import type { TranscriptOpenSessionRole } from "@proliferate/product-domain/chats/transcript/transcript-open-target";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import {
  ChatTranscriptView,
  type ChatTranscriptPendingPromptRenderInput,
  type ChatTranscriptTurnRowRenderInput,
} from "@proliferate/product-ui/chat/transcript/ChatTranscriptView";
import type { ChatTranscriptState } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import {
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import { TranscriptContextProviders, type TranscriptOpenSessionHandler } from "./TranscriptContexts";
import { TranscriptPendingPromptRow } from "./TranscriptPendingPromptRow";
import { TranscriptTurnRow } from "./TranscriptTurnRow";

const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

interface MessageListProps {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  optimisticPrompt: PendingPromptEntry | null;
  outboxEntries?: readonly PromptOutboxEntry[];
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
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

  const handleTranscriptScroll = useCallback(() => {
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

  return (
    <DebugProfiler id="transcript-list">
      <DebugProfiler id="transcript-context-providers">
        <TranscriptContextProviders
          sessionId={activeSessionId}
          onOpenSession={onOpenSession}
          canOpenSession={canOpenSession}
        >
          <DebugProfiler id="transcript-row-list-router">
            <ChatTranscriptView
              state={transcriptViewState}
              outboxActions={outboxActions}
              onScrollSample={handleTranscriptScroll}
              renderPendingPromptRow={renderPendingPromptRow}
              renderTurnRow={renderTurnRow}
              renderPendingPromptTrailingStatus={(input) =>
                resolvePendingPromptTrailingStatus(
                  input.queuedAt,
                  input.sessionViewState,
                  input.forceWorking,
                )}
              renderTurnTrailingStatus={(input) =>
                resolveTurnTrailingStatus(
                  input.startedAt,
                  input.sessionViewState,
                  input.transientStatusText,
                )}
            />
          </DebugProfiler>
        </TranscriptContextProviders>
      </DebugProfiler>
    </DebugProfiler>
  );
}
