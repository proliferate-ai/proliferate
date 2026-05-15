import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { CHAT_SCROLL_BASE_BOTTOM_PADDING_PX } from "@/config/chat-layout";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useOpenCoworkArtifact } from "@/hooks/cowork/workflows/use-open-cowork-artifact";
import { useChatTranscriptSelection } from "@/hooks/chat/ui/use-chat-transcript-selection";
import type { PromptPlanAttachmentDescriptor } from "@/lib/domain/chat/composer/prompt-plan-attachments";
import { buildTranscriptCopyText } from "@/lib/domain/chat/transcript/transcript-copy";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  measureDebugComputation,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  turnHasAssistantRenderableTranscriptContent,
  resolveVisibleOptimisticPrompt,
  shouldShowPendingPromptActivity,
} from "@/lib/domain/chat/pending-prompts/pending-prompts";
import {
  outboxEntryToPendingPromptEntry,
  renderableOutboxEntriesForTranscript,
} from "@/lib/domain/sessions/intents/session-intent-selectors";
import type { PromptOutboxEntry } from "@/lib/domain/sessions/intents/session-intent-model";
import type { TranscriptVirtualRow } from "@/lib/domain/chat/transcript/transcript-virtual-rows";
import { useTranscriptRowModel } from "@/hooks/chat/derived/use-transcript-row-model";
import { usePromptOutboxActions } from "@/hooks/chat/workflows/use-prompt-outbox-actions";
import {
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@/lib/domain/chat/transcript/transcript-trailing-status";
import {
  buildOutboxStartedAtByPromptId,
  collectToolCallIdsWithProposedPlan,
  findTrailingLiveExplorationBlock,
  findTrailingLiveWorkBlock,
  resolveTurnPromptTiming,
} from "@/lib/domain/chat/transcript/transcript-rendering";
import type { TranscriptOpenSessionRole } from "@/lib/domain/chat/transcript/transcript-open-target";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import { VirtualTranscriptRowList } from "@/components/workspace/chat/transcript/VirtualTranscriptRowList";
import {
  resolvePendingPromptTrailingStatus,
  resolveTurnTrailingStatus,
} from "@/components/workspace/chat/transcript/TranscriptTurnChrome";
import { TranscriptContextProviders, type TranscriptOpenSessionHandler } from "./TranscriptContexts";
import { TranscriptPendingPromptRow } from "./TranscriptPendingPromptRow";
import { TranscriptTurnRow } from "./TranscriptTurnRow";

const noop = () => {};
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
type PlanHandoffHandler = (plan: PromptPlanAttachmentDescriptor) => void;

const LIVE_STATUS_GRACE_MS = 700;

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
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
  const { openFile, openGitReviewPane } = useWorkspaceFileActions();
  const { openArtifact } = useOpenCoworkArtifact();
  const latestTurnHasAssistantRenderableContent = turnHasAssistantRenderableTranscriptContent(
    latestTurn,
    transcript,
  );
  const visibleOptimisticPrompt = resolveVisibleOptimisticPrompt({
    optimisticPrompt,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnHasAssistantRenderableContent,
  });
  const optimisticPromptTrailingStatus = visibleOptimisticPrompt
    && shouldShowPendingPromptActivity({
      optimisticPrompt: visibleOptimisticPrompt,
      sessionViewState,
    })
    ? resolvePendingPromptTrailingStatus(
      visibleOptimisticPrompt.queuedAt,
      sessionViewState,
      true,
    )
    : null;
  const visibleOutboxEntries = useMemo(
    () => measureDebugComputation({
      category: "transcript_list.derive",
      label: "visible_outbox_entries",
      keys: ["outboxEntries", "transcript"],
      count: (entries) => entries.length,
    }, () => renderableOutboxEntriesForTranscript(outboxEntries, transcript)),
    [outboxEntries, transcript],
  );
  const outboxStartedAtByPromptId = useMemo(
    () => buildOutboxStartedAtByPromptId(outboxEntries),
    [outboxEntries],
  );
  const virtualRows = useTranscriptRowModel({
    activeSessionId,
    transcript,
    visibleOptimisticPrompt,
    visibleOutboxEntries,
    latestTurnId,
    latestTurnHasAssistantRenderableContent,
  });
  const visibleTurnIds = useMemo(
    () => {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const row of virtualRows) {
        if (row.kind !== "turn" || seen.has(row.turnId)) {
          continue;
        }
        seen.add(row.turnId);
        ids.push(row.turnId);
      }
      return ids;
    },
    [virtualRows],
  );
  const latestTurnInProgress = !!latestTurn && !latestTurn.completedAt;
  const latestTurnPresentation = useMemo(
    () => {
      if (!latestTurnId) {
        return null;
      }
      const latestRow = virtualRows.find((row) =>
        row.kind === "turn" && row.turnId === latestTurnId
      );
      return latestRow?.kind === "turn" ? latestRow.presentation : null;
    },
    [latestTurnId, virtualRows],
  );
  const latestLiveExplorationBlock = useMemo(
    () => latestTurnPresentation
      ? findTrailingLiveExplorationBlock(
          latestTurnPresentation.displayBlocks,
          transcript,
          latestTurnInProgress,
        )
      : null,
    [latestTurnInProgress, latestTurnPresentation, transcript],
  );
  const latestLiveWorkBlock = useMemo(
    () => latestTurnPresentation
      ? findTrailingLiveWorkBlock(
          latestTurnPresentation.displayBlocks,
          transcript,
          latestTurnInProgress,
        )
      : null,
    [latestTurnInProgress, latestTurnPresentation, transcript],
  );
  const latestTransientText = latestTurn
    ? latestTransientStatusText(latestTurn, transcript)
    : null;
  const latestTurnTiming = latestTurn
    ? resolveTurnPromptTiming(latestTurn, transcript, outboxStartedAtByPromptId)
    : null;
  const shouldShowDelayedLatestLiveStatus = !!latestTurn
    && latestTurnInProgress
    && !latestLiveWorkBlock
    && sessionViewState === "working"
    && shouldAllowTurnTrailingStatus({
      turn: latestTurn,
      transcript,
      isLatestTurnInProgress: true,
    });
  const shouldShowImmediateOutboxLiveStatus =
    shouldShowDelayedLatestLiveStatus
    && latestTurnTiming?.isOutboxStartedAt === true;
  const [showDelayedLatestLiveStatus, setShowDelayedLatestLiveStatus] = useState(false);

  useEffect(() => {
    if (!shouldShowDelayedLatestLiveStatus) {
      setShowDelayedLatestLiveStatus(false);
      return;
    }

    setShowDelayedLatestLiveStatus(false);
    const timeout = window.setTimeout(() => {
      setShowDelayedLatestLiveStatus(true);
    }, LIVE_STATUS_GRACE_MS);
    return () => window.clearTimeout(timeout);
  }, [
    latestTransientText,
    latestTurn?.itemOrder.length,
    latestTurnTiming?.startedAt,
    latestTurnId,
    shouldShowDelayedLatestLiveStatus,
  ]);

  const latestLiveStatus = latestTurn
    && (showDelayedLatestLiveStatus || shouldShowImmediateOutboxLiveStatus)
      ? resolveTurnTrailingStatus(
          latestTurnTiming?.startedAt ?? latestTurn.startedAt,
          sessionViewState,
          latestTransientText,
        )
      : null;
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const getTranscriptCopyText = useCallback(() => buildTranscriptCopyText({
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
    proposedPlanToolCallIds: collectToolCallIdsWithProposedPlan(transcript),
  }), [
    transcript,
    visibleTurnIds,
    visibleOptimisticPrompt,
  ]);

  useChatTranscriptSelection({
    rootRef: selectionRootRef,
    getCopyText: getTranscriptCopyText,
  });
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

  const renderVirtualRow = useCallback((row: TranscriptVirtualRow, rowIndex: number) => {
    if (row.kind === "pending_prompt" || row.kind === "outbox_prompt") {
      const outboxEntry = row.kind === "outbox_prompt"
        ? visibleOutboxEntries.find((entry) => entry.clientPromptId === row.clientPromptId) ?? null
        : null;
      const prompt = row.kind === "pending_prompt"
        ? visibleOptimisticPrompt
        : outboxEntry
          ? outboxEntryToPendingPromptEntry(outboxEntry)
          : null;
      if (!visibleOptimisticPrompt) {
        if (!outboxEntry) {
          return null;
        }
      }
      if (!prompt) {
        return null;
      }
      return (
        <TranscriptPendingPromptRow
          activeSessionId={activeSessionId}
          rowIndex={rowIndex}
          prompt={prompt}
          outboxEntry={outboxEntry}
          optimisticTrailingStatus={optimisticPromptTrailingStatus}
          outboxActions={outboxActions}
        />
      );
    }

    const turn = transcript.turnsById[row.turnId];
    if (!turn) {
      return null;
    }

    return (
      <TranscriptTurnRow
        row={row}
        rowIndex={rowIndex}
        turn={turn}
        transcript={transcript}
        latestTurnId={latestTurnId}
        latestLiveExplorationBlock={latestLiveExplorationBlock}
        latestLiveStatus={latestLiveStatus}
        outboxStartedAtByPromptId={outboxStartedAtByPromptId}
        selectedWorkspaceId={selectedWorkspaceId}
        sessionViewState={sessionViewState}
        onOpenFile={(filePath) => void openFile(filePath)}
        onOpenTurnChanges={() => openGitReviewPane({ mode: "last_turn" })}
        onOpenArtifact={openArtifact}
        onHandOffPlanToNewSession={onHandOffPlanToNewSession}
      />
    );
  }, [
    activeSessionId,
    latestLiveExplorationBlock,
    latestLiveStatus,
    latestTurnId,
    onHandOffPlanToNewSession,
    openArtifact,
    openFile,
    openGitReviewPane,
    optimisticPromptTrailingStatus,
    outboxStartedAtByPromptId,
    outboxActions,
    selectedWorkspaceId,
    sessionViewState,
    transcript,
    visibleOutboxEntries,
    visibleOptimisticPrompt,
  ]);

  return (
    <DebugProfiler id="transcript-list">
      <div className="flex-1 min-h-0" data-telemetry-block>
        <DebugProfiler id="transcript-context-providers">
          <TranscriptContextProviders
            sessionId={activeSessionId}
            onOpenSession={onOpenSession}
            canOpenSession={canOpenSession}
          >
            <DebugProfiler id="transcript-row-list-router">
              <VirtualTranscriptRowList
                key={`${selectedWorkspaceId ?? "workspace"}:${activeSessionId}`}
                rows={virtualRows}
                selectionRootRef={selectionRootRef}
                hasOlderHistory={hasOlderHistory}
                isLoadingOlderHistory={isLoadingOlderHistory}
                olderHistoryCursor={olderHistoryCursor}
                bottomInsetPx={bottomInsetPx}
                selectedWorkspaceId={selectedWorkspaceId}
                activeSessionId={activeSessionId}
                isSessionBusy={sessionViewState === "working" || sessionViewState === "needs_input"}
                pendingPromptText={visibleOptimisticPrompt?.text ?? null}
                onLoadOlderHistory={onLoadOlderHistory ?? noop}
                onScrollSample={handleTranscriptScroll}
                renderRow={renderVirtualRow}
              />
            </DebugProfiler>
          </TranscriptContextProviders>
        </DebugProfiler>
      </div>
    </DebugProfiler>
  );
}
