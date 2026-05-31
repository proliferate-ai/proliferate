import type { CloudTranscriptStateSource } from "@proliferate/product-domain/chats/cloud/transcript-view";

export function shouldShowInitialCloudTranscriptLoading(input: {
  hasSession: boolean;
  sessionEventsLoading: boolean;
  transcriptSnapshotLoading: boolean;
  transcriptSource: CloudTranscriptStateSource;
  visibleTranscriptRowCount: number;
  hasSharedTranscriptState: boolean;
}): boolean {
  return input.hasSession
    && (input.sessionEventsLoading || input.transcriptSnapshotLoading)
    && input.transcriptSource === "empty"
    && input.visibleTranscriptRowCount === 0
    && !input.hasSharedTranscriptState;
}
