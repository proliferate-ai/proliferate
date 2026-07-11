import { describe, expect, it } from "vitest";
import {
  resolveTurnAssistantFooterMode,
  resolveTranscriptTurnDiffPanelKind,
  shouldRenderStandaloneStoppedNotice,
} from "./TranscriptTurnRow";
import { resolveCompletedHistoryDisclosureLabel } from "./TurnItemSequence";

describe("resolveTranscriptTurnDiffPanelKind", () => {
  it("uses current git diffs only for the latest completed turn row", () => {
    expect(resolveTranscriptTurnDiffPanelKind({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      turnId: "turn-latest",
      latestCompletedTurnId: "turn-latest",
      hasFileBadges: true,
    })).toBe("current");
  });

  it("uses recorded transcript patches for older completed turn rows", () => {
    expect(resolveTranscriptTurnDiffPanelKind({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      turnId: "turn-older",
      latestCompletedTurnId: "turn-latest",
      hasFileBadges: true,
    })).toBe("transcript");
  });

  it("does not render a diff panel for partial rows or turns without file badges", () => {
    expect(resolveTranscriptTurnDiffPanelKind({
      rowIsLastTurnRow: false,
      turnCompleted: true,
      turnId: "turn-latest",
      latestCompletedTurnId: "turn-latest",
      hasFileBadges: true,
    })).toBeNull();
    expect(resolveTranscriptTurnDiffPanelKind({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      turnId: "turn-latest",
      latestCompletedTurnId: "turn-latest",
      hasFileBadges: false,
    })).toBeNull();
  });
});

describe("resolveTurnAssistantFooterMode", () => {
  it("keeps the footer reserved when a tool-only or stopped turn completes", () => {
    expect(resolveTurnAssistantFooterMode({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      hasAssistantCopyContent: false,
    })).toBe("reserved");
  });

  it("swaps the reserved footer to copy controls only when final prose exists", () => {
    expect(resolveTurnAssistantFooterMode({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      hasAssistantCopyContent: true,
    })).toBe("copy");
    expect(resolveTurnAssistantFooterMode({
      rowIsLastTurnRow: false,
      turnCompleted: true,
      hasAssistantCopyContent: true,
    })).toBe("none");
  });
});

describe("stopped turn disclosure", () => {
  const turnTiming = {
    startedAt: "2026-04-13T12:00:00.000Z",
    completedAt: "2026-04-13T12:00:23.000Z",
  };

  it("replaces the Worked label with the stopped label", () => {
    expect(resolveCompletedHistoryDisclosureLabel(
      turnTiming,
      "You stopped after 23s",
    )).toBe("You stopped after 23s");
  });

  it("suppresses the duplicate footer when the work disclosure owns the notice", () => {
    expect(shouldRenderStandaloneStoppedNotice("You stopped after 23s", true)).toBe(false);
    expect(shouldRenderStandaloneStoppedNotice("You stopped after 23s", false)).toBe(true);
    expect(shouldRenderStandaloneStoppedNotice(null, false)).toBe(false);
  });
});
