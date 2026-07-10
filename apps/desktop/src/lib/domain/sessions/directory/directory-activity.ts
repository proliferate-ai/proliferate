import type {
  SessionExecutionSummary,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";
import { resolveSessionErrorAttentionKey } from "@proliferate/product-domain/sessions/activity";
import { transcriptEndsInFinalAssistantProse } from "@proliferate/product-domain/chats/transcript/transcript-trailing-status";
import type {
  SessionDirectoryActivitySummary,
  SessionDirectoryEntry,
} from "@/lib/domain/sessions/directory/directory-entry";

export function activityFromTranscript(
  transcript: TranscriptState,
  context?: {
    status?: SessionStatus | null;
    executionSummary?: SessionExecutionSummary | null;
  },
): SessionDirectoryActivitySummary {
  return {
    isStreaming: transcript.isStreaming,
    pendingInteractions: transcript.pendingInteractions,
    endsInFinalAssistantProse: transcriptEndsInFinalAssistantProse(transcript),
    transcriptTitle: transcript.sessionMeta.title ?? null,
    errorAttentionKey: resolveSessionErrorAttentionKey({
      sessionId: transcript.sessionMeta.sessionId,
      status: context?.status ?? null,
      executionSummary: context?.executionSummary ?? null,
      transcript: {
        itemsById: transcript.itemsById,
      },
    }),
  };
}

export function activitySnapshotFromDirectoryEntry(
  entry: SessionDirectoryEntry | null | undefined,
) {
  return entry
    ? {
      status: entry.status,
      executionSummary: entry.executionSummary,
      streamConnectionState: entry.streamConnectionState,
      hasPromptActivity: entry.lastPromptAt !== null || entry.hasAttemptedPrompt,
      transcript: {
        isStreaming: entry.activity.isStreaming,
        pendingInteractions: entry.activity.pendingInteractions,
        endsInFinalAssistantProse: entry.activity.endsInFinalAssistantProse,
      },
    }
    : null;
}
