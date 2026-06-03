import { describe, expect, it } from "vitest";
import { resolveTranscriptTurnDiffPanelKind } from "./TranscriptTurnRow";

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
