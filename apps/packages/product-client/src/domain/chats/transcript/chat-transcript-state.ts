import type {
  PendingPromptEntry,
  TranscriptState,
} from "@anyharness/sdk";
import type { SessionViewState } from "../../sessions/activity";
import type { PromptOutboxEntry } from "../../sessions/intents/session-intent-model";
import type { GoalTranscriptEvent } from "../../activity/goal-transcript-events";
import type { BackgroundCompletionReceipt } from "../../activity/background-completion-receipt";

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
  /**
   * Goal lifecycle rows composed client-side from the raw session event
   * stream (see `deriveGoalTranscriptEvents`). Omitted/empty for surfaces
   * that don't render goal state (e.g. the cloud preview transcript).
   */
  goalEvents?: readonly GoalTranscriptEvent[];
  /**
   * Workspace-creation receipt identity. Client-side composition like
   * goalEvents — set only by surfaces that pin the creation receipt to the
   * top of the transcript (the workspace chat). The view model drops it
   * while older history pages remain unloaded.
   */
  workspaceReceiptKey?: string | null;
  /**
   * Inline background-work completion receipts (bgwork r6 round 2), interleaved
   * into the row sequence after each receipt's anchor turn. Client-side
   * composition like `goalEvents`; set only by the main chat surface.
   */
  completionReceipts?: readonly BackgroundCompletionReceipt[];
  /**
   * Count of still-running background work; drives the quiet `background_work`
   * footer row at the transcript tail (bgwork r6 round 2). 0/undefined renders
   * no row.
   */
  backgroundWorkRunningCount?: number;
}

export interface ChatTranscriptHistoryState {
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  olderHistoryCursor?: number | null;
  onLoadOlderHistory?: () => void;
}

export interface ChatTranscriptLayoutState {
  bottomInsetPx?: number;
  /**
   * Portion of bottomInsetPx created by cards above the composer. It expands
   * the manual scroll range without moving an already-rendered transcript.
   */
  nonDisplacingBottomInsetPx?: number;
  columnClassName?: string;
  gutterClassName?: string;
}
