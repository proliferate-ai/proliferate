import type { ReactNode, RefObject } from "react";
import type {
  ChatTranscriptState,
  PendingPromptEntry,
  TranscriptState,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";

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

export interface ChatTranscriptGoalEventRenderInput {
  row: Extract<TranscriptVirtualRow, { kind: "goal_event" }>;
  rowIndex: number;
  event: GoalTranscriptEvent;
}

/** Active chat content-search state driving the prose paint layer. */
export interface ChatTranscriptContentSearch {
  query: string;
}

/**
 * Imperative handle exposed by ChatTranscriptView so the content-search
 * jump-to-match can bring an off-screen (virtualized) row into view before the
 * mark it targets can be found in the DOM.
 */
export interface ChatTranscriptScrollHandle {
  scrollToRowKey: (rowKey: string) => void;
}

export interface ChatTranscriptViewProps {
  state: ChatTranscriptState;
  outboxActions?: ChatTranscriptOutboxActions;
  onScrollSample?: (sample?: import("./useTranscriptStickToBottom").TranscriptScrollSample) => void;
  renderPendingPromptRow: (input: ChatTranscriptPendingPromptRenderInput) => ReactNode;
  renderTurnRow: (input: ChatTranscriptTurnRowRenderInput) => ReactNode;
  renderPendingPromptTrailingStatus?: (input: ChatTranscriptPendingStatusInput) => ReactNode;
  renderTurnTrailingStatus?: (input: ChatTranscriptTurnStatusInput) => ReactNode;
  /** Omitted surfaces (e.g. the cloud preview transcript) render no goal rows. */
  renderGoalEventRow?: (input: ChatTranscriptGoalEventRenderInput) => ReactNode;
  /**
   * Chat content search. When set (search open on the chat surface), the
   * transcript prose is highlighted for `query`. Null/undefined disables the
   * paint layer entirely (zero cost).
   */
  contentSearch?: ChatTranscriptContentSearch | null;
  /** Ref to the imperative scroll handle for content-search jump-to-match. */
  scrollHandleRef?: RefObject<ChatTranscriptScrollHandle | null>;
}
