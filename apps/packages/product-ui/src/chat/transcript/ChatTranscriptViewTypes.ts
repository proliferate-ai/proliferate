import type { ReactNode } from "react";
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
