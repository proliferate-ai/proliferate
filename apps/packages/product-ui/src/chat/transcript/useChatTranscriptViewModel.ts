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
import type {
  ChatTranscriptPendingStatusInput,
  ChatTranscriptTurnStatusInput,
  ChatTranscriptViewProps,
} from "./ChatTranscriptViewTypes";
import { collectVisibleTurnIds } from "./ChatTranscriptViewRules";
import { useLatestTranscriptLiveStatus } from "./useLatestTranscriptLiveStatus";
import { useSharedTranscriptRowModel } from "./useSharedTranscriptRowModel";

const noop = () => {};
const EMPTY_OUTBOX_ENTRIES: readonly PromptOutboxEntry[] = [];

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
    reasoningActive = false,
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
    reasoningActive,
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
