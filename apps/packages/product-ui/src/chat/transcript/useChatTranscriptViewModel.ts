import { useMemo, type ReactNode } from "react";
import type {
  PendingPromptEntry,
  TranscriptState,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import { buildOutboxStartedAtByPromptId } from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  turnHasAssistantRenderableTranscriptContent,
  resolveVisibleOptimisticPrompt,
  shouldShowPendingPromptActivity,
} from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import { renderableOutboxEntriesForTranscript } from "@proliferate/product-domain/sessions/intents/session-intent-selectors";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";
import type {
  ChatTranscriptPendingStatusInput,
  ChatTranscriptTurnStatusInput,
  ChatTranscriptViewProps,
} from "./ChatTranscriptViewTypes";
import { collectVisibleTurnIds } from "./ChatTranscriptViewRules";
import { useLatestTranscriptLiveStatus } from "./useLatestTranscriptLiveStatus";
import { useSharedTranscriptRowModel } from "./useSharedTranscriptRowModel";
import { useOptimisticPromptHandoff } from "./useOptimisticPromptHandoff";

const noop = () => {};
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];
const EMPTY_GOAL_EVENTS: readonly GoalTranscriptEvent[] = [];

export interface ChatTranscriptViewModel {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  olderHistoryCursor: number | null;
  onLoadOlderHistory: () => void;
  bottomInsetPx: number;
  nonDisplacingBottomInsetPx: number;
  columnClassName: string | undefined;
  gutterClassName: string | undefined;
  visibleOptimisticPrompt: PendingPromptEntry | null;
  optimisticPromptTrailingStatus: ReactNode;
  visibleOutboxEntries: readonly PromptOutboxEntry[];
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  virtualRows: readonly TranscriptVirtualRow[];
  visibleTurnIds: readonly string[];
  latestTurnId: string | null;
  latestLiveExplorationBlock: Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null;
  latestLiveStatus: ReactNode;
}

export function useChatTranscriptViewModel({
  state,
  renderPendingPromptTrailingStatus,
  renderTurnTrailingStatus,
}: {
  state: ChatTranscriptViewProps["state"];
  renderPendingPromptTrailingStatus?: (input: ChatTranscriptPendingStatusInput) => ReactNode;
  renderTurnTrailingStatus?: (input: ChatTranscriptTurnStatusInput) => ReactNode;
}): ChatTranscriptViewModel {
  const {
    activeSessionId,
    selectedWorkspaceId,
    optimisticPrompt = null,
    outboxEntries = EMPTY_OUTBOX_ENTRIES,
    transcript,
    sessionViewState,
    history,
    layout,
    goalEvents = EMPTY_GOAL_EVENTS,
  } = state;
  const hasOlderHistory = history?.hasOlderHistory ?? false;
  const isLoadingOlderHistory = history?.isLoadingOlderHistory ?? false;
  const olderHistoryCursor = history?.olderHistoryCursor ?? null;
  const onLoadOlderHistory = history?.onLoadOlderHistory ?? noop;
  const bottomInsetPx = layout?.bottomInsetPx ?? 40;
  const nonDisplacingBottomInsetPx = Math.min(
    bottomInsetPx,
    Math.max(0, layout?.nonDisplacingBottomInsetPx ?? 0),
  );
  const columnClassName = layout?.columnClassName;
  const gutterClassName = layout?.gutterClassName;
  const latestTurnId = transcript.turnOrder[transcript.turnOrder.length - 1] ?? null;
  const latestTurn = latestTurnId ? transcript.turnsById[latestTurnId] ?? null : null;
  const latestTurnHasAssistantRenderableContent = turnHasAssistantRenderableTranscriptContent(
    latestTurn,
    transcript,
  );
  const optimisticPromptHandoff = useOptimisticPromptHandoff({
    activeSessionId,
    optimisticPrompt,
    latestTurn,
    latestTurnHasAssistantRenderableContent,
    sessionViewState,
  });
  const visibleOptimisticPrompt = resolveVisibleOptimisticPrompt({
    optimisticPrompt: optimisticPromptHandoff,
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
  const visibleOptimisticPromptId = visibleOptimisticPrompt?.promptId ?? null;
  const visibleOutboxEntries = useMemo(
    () => renderableOutboxEntriesForTranscript(outboxEntries, transcript)
      // The same prompt must render exactly once: if the session-level
      // optimistic prompt already shows it, skip its outbox row.
      .filter((entry) =>
        visibleOptimisticPromptId === null
        || entry.clientPromptId !== visibleOptimisticPromptId,
      ),
    [outboxEntries, transcript, visibleOptimisticPromptId],
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
    goalEvents,
  });
  const visibleTurnIds = useMemo(
    () => collectVisibleTurnIds(virtualRows),
    [virtualRows],
  );
  const {
    latestLiveExplorationBlock,
    latestLiveStatus,
  } = useLatestTranscriptLiveStatus({
    latestTurnId,
    latestTurn,
    transcript,
    virtualRows,
    outboxStartedAtByPromptId,
    sessionViewState,
    renderTurnTrailingStatus,
  });

  return {
    activeSessionId,
    selectedWorkspaceId,
    transcript,
    sessionViewState,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryCursor,
    onLoadOlderHistory,
    bottomInsetPx,
    nonDisplacingBottomInsetPx,
    columnClassName,
    gutterClassName,
    visibleOptimisticPrompt,
    optimisticPromptTrailingStatus,
    visibleOutboxEntries,
    outboxStartedAtByPromptId,
    virtualRows,
    visibleTurnIds,
    latestTurnId,
    latestLiveExplorationBlock,
    latestLiveStatus,
  };
}
