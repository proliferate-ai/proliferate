import { describe, expect, it } from "vitest";
import { shouldShowInitialCloudTranscriptLoading } from "./cloud-chat-loading-presentation";

describe("shouldShowInitialCloudTranscriptLoading", () => {
  it("shows while either initial transcript source is still loading", () => {
    expect(shouldShowInitialCloudTranscriptLoading({
      hasSession: true,
      sessionEventsLoading: false,
      transcriptSnapshotLoading: true,
      transcriptSource: "empty",
      visibleTranscriptRowCount: 0,
      hasSharedTranscriptState: false,
    })).toBe(true);
  });

  it("stays hidden when there is no active session", () => {
    expect(shouldShowInitialCloudTranscriptLoading({
      hasSession: false,
      sessionEventsLoading: true,
      transcriptSnapshotLoading: true,
      transcriptSource: "empty",
      visibleTranscriptRowCount: 0,
      hasSharedTranscriptState: false,
    })).toBe(false);
  });

  it("stays hidden once transcript content can render", () => {
    expect(shouldShowInitialCloudTranscriptLoading({
      hasSession: true,
      sessionEventsLoading: true,
      transcriptSnapshotLoading: true,
      transcriptSource: "events",
      visibleTranscriptRowCount: 0,
      hasSharedTranscriptState: false,
    })).toBe(false);

    expect(shouldShowInitialCloudTranscriptLoading({
      hasSession: true,
      sessionEventsLoading: true,
      transcriptSnapshotLoading: true,
      transcriptSource: "empty",
      visibleTranscriptRowCount: 1,
      hasSharedTranscriptState: false,
    })).toBe(false);

    expect(shouldShowInitialCloudTranscriptLoading({
      hasSession: true,
      sessionEventsLoading: true,
      transcriptSnapshotLoading: true,
      transcriptSource: "empty",
      visibleTranscriptRowCount: 0,
      hasSharedTranscriptState: true,
    })).toBe(false);
  });
});
