import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import type { PromptOutboxEntry } from "@proliferate/product-domain/sessions/intents/session-intent-model";

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
