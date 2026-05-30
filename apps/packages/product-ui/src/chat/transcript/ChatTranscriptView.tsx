import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatTranscriptState,
  PendingPromptEntry,
  TranscriptState,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import {
  buildOutboxStartedAtByPromptId,
  collectToolCallIdsWithProposedPlan,
  findTrailingLiveExplorationBlock,
  findTrailingLiveWorkBlock,
  resolveTurnPromptTiming,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@proliferate/product-domain/chats/transcript/transcript-trailing-status";
import {
  turnHasAssistantRenderableTranscriptContent,
  resolveVisibleOptimisticPrompt,
  shouldShowPendingPromptActivity,
} from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import {
  outboxEntryToPendingPromptEntry,
  renderableOutboxEntriesForTranscript,
} from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
} from "@proliferate/product-domain/chats/transcript/transcript-row-model";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import { buildTranscriptCopyText } from "@proliferate/product-domain/chats/transcript/transcript-copy";
import { VirtualTranscriptRowList } from "./VirtualTranscriptRowList";
import { useChatTranscriptSelection } from "./ChatTranscriptSelection";

const noop = () => {};
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
const NOOP_OUTBOX_ACTIONS: ChatTranscriptOutboxActions = {
  retryPrompt: noop,
  dismissPrompt: noop,
};
const LIVE_STATUS_GRACE_MS = 700;

export interface ChatTranscriptOutboxActions {
  retryPrompt: (clientPromptId: string) => void;
  dismissPrompt: (clientPromptId: string) => void;
}

export interface ChatTranscriptPendingPromptRenderInput {
  activeSessionId: string;
  row: Extract<TranscriptVirtualRow, { kind: "pending_prompt" | "outbox_prompt" }>;
  rowIndex: number;
  prompt: PendingPromptEntry;
  outboxEntry: PromptOutboxEntry | null;
  optimisticTrailingStatus: ReactNode;
  outboxActions: ChatTranscriptOutboxActions;
}

export interface ChatTranscriptTurnRowRenderInput {
  row: Extract<TranscriptVirtualRow, { kind: "turn" }>;
  rowIndex: number;
  turn: TurnRecord;
  transcript: TranscriptState;
  latestTurnId: string | null;
  latestLiveExplorationBlock: Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null;
  latestLiveStatus: ReactNode;
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  selectedWorkspaceId: string | null;
  sessionViewState: SessionViewState;
}

export interface ChatTranscriptPendingStatusInput {
  queuedAt: string;
  sessionViewState: SessionViewState;
  forceWorking: boolean;
}

export interface ChatTranscriptTurnStatusInput {
  startedAt: string;
  sessionViewState: SessionViewState;
  transientStatusText: string | null;
}

export interface ChatTranscriptViewProps {
  state: ChatTranscriptState;
  outboxActions?: ChatTranscriptOutboxActions;
  onScrollSample?: () => void;
  renderPendingPromptRow: (input: ChatTranscriptPendingPromptRenderInput) => ReactNode;
  renderTurnRow: (input: ChatTranscriptTurnRowRenderInput) => ReactNode;
  renderPendingPromptTrailingStatus?: (input: ChatTranscriptPendingStatusInput) => ReactNode;
  renderTurnTrailingStatus?: (input: ChatTranscriptTurnStatusInput) => ReactNode;
}

export function ChatTranscriptView({
  state,
  outboxActions = NOOP_OUTBOX_ACTIONS,
  onScrollSample = noop,
  renderPendingPromptRow,
  renderTurnRow,
  renderPendingPromptTrailingStatus,
  renderTurnTrailingStatus,
}: ChatTranscriptViewProps) {
  const {
    activeSessionId,
    selectedWorkspaceId,
    optimisticPrompt = null,
    outboxEntries = EMPTY_OUTBOX_ENTRIES,
    transcript,
    sessionViewState,
    history,
    layout,
  } = state;
  const hasOlderHistory = history?.hasOlderHistory ?? false;
  const isLoadingOlderHistory = history?.isLoadingOlderHistory ?? false;
  const olderHistoryCursor = history?.olderHistoryCursor ?? null;
  const onLoadOlderHistory = history?.onLoadOlderHistory ?? noop;
  const bottomInsetPx = layout?.bottomInsetPx ?? 40;
  const columnClassName = layout?.columnClassName;
  const gutterClassName = layout?.gutterClassName;
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
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
    ? renderPendingPromptTrailingStatus?.({
        queuedAt: visibleOptimisticPrompt.queuedAt,
        sessionViewState,
        forceWorking: true,
      }) ?? null
    : null;
  const visibleOutboxEntries = useMemo(
    () => renderableOutboxEntriesForTranscript(outboxEntries, transcript),
    [outboxEntries, transcript],
  );
  const outboxStartedAtByPromptId = useMemo(
    () => buildOutboxStartedAtByPromptId(outboxEntries),
    [outboxEntries],
  );
  const virtualRows = useSharedTranscriptRowModel({
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
    && transcript.isStreaming
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
      ? renderTurnTrailingStatus?.({
          startedAt: latestTurnTiming?.startedAt ?? latestTurn.startedAt,
          sessionViewState,
          transientStatusText: latestTransientText,
        }) ?? null
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
      if (!prompt) {
        return null;
      }
      return renderPendingPromptRow({
        activeSessionId,
        row,
        rowIndex,
        prompt,
        outboxEntry,
        optimisticTrailingStatus: optimisticPromptTrailingStatus,
        outboxActions,
      });
    }

    const turn = transcript.turnsById[row.turnId];
    if (!turn) {
      return null;
    }

    return renderTurnRow({
      row,
      rowIndex,
      turn,
      transcript,
      latestTurnId,
      latestLiveExplorationBlock,
      latestLiveStatus,
      outboxStartedAtByPromptId,
      selectedWorkspaceId,
      sessionViewState,
    });
  }, [
    activeSessionId,
    latestLiveExplorationBlock,
    latestLiveStatus,
    latestTurnId,
    optimisticPromptTrailingStatus,
    outboxActions,
    outboxStartedAtByPromptId,
    renderPendingPromptRow,
    renderTurnRow,
    selectedWorkspaceId,
    sessionViewState,
    transcript,
    visibleOutboxEntries,
    visibleOptimisticPrompt,
  ]);

  return (
    <div className="flex-1 min-h-0" data-telemetry-block>
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
        onLoadOlderHistory={onLoadOlderHistory}
        onScrollSample={onScrollSample}
        renderRow={renderVirtualRow}
        columnClassName={columnClassName}
        gutterClassName={gutterClassName}
      />
    </div>
  );
}

function useSharedTranscriptRowModel(input: {
  activeSessionId: string;
  transcript: TranscriptState;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  latestTurnId: string | null;
  latestTurnHasAssistantRenderableContent: boolean;
}): readonly TranscriptVirtualRow[] {
  const cacheRef = useRef(createTranscriptRowModelCache());

  return useMemo(
    () => buildTranscriptRowModel(input, cacheRef.current),
    [
      input.activeSessionId,
      input.latestTurnHasAssistantRenderableContent,
      input.latestTurnId,
      input.transcript,
      input.visibleOptimisticPrompt,
      input.visibleOutboxEntries,
    ],
  );
}
