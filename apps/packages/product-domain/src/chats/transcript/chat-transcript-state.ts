import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "../../sessions/activity";
import type { PromptOutboxEntry } from "../../sessions/intents/session-intent-model";

export type {
  PendingPromptEntry,
  TranscriptState,
  TurnRecord,
} from "@anyharness/sdk";

export interface ChatTranscriptState {
  activeSessionId: string;
  selectedWorkspaceId: string | null;
  transcript: TranscriptState;
  sessionViewState: SessionViewState;
  optimisticPrompt?: PendingPromptEntry | null;
  outboxEntries?: readonly PromptOutboxEntry[];
  history?: ChatTranscriptHistoryState;
  layout?: ChatTranscriptLayoutState;
}

export interface ChatTranscriptHistoryState {
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  olderHistoryCursor?: number | null;
  onLoadOlderHistory?: () => void;
}

export interface ChatTranscriptLayoutState {
  bottomInsetPx?: number;
  columnClassName?: string;
  gutterClassName?: string;
}
