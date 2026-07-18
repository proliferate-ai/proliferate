import { describe, expect, it } from "vitest";
import {
  resolveTurnAssistantFooterMode,
  resolveTranscriptTurnDiffPanelKind,
  shouldRenderStandaloneStoppedNotice,
} from "#product/components/workspace/chat/transcript/TranscriptTurnRow";
import {
  isRecentAssistantCompletion,
  RECENT_ASSISTANT_REVEAL_WINDOW_MS,
  shouldHoldAssistantRevealFrontier,
} from "#product/hooks/chat/ui/use-assistant-reveal-frontier";
import { resolveCompletedHistoryDisclosureLabel } from "#product/components/workspace/chat/transcript/TurnItemSequence";

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
      assistantRevealComplete: true,
    })).toBe("reserved");
  });

  it("swaps the reserved footer to copy controls only when final prose exists", () => {
    expect(resolveTurnAssistantFooterMode({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      hasAssistantCopyContent: true,
      assistantRevealComplete: true,
    })).toBe("copy");
    expect(resolveTurnAssistantFooterMode({
      rowIsLastTurnRow: false,
      turnCompleted: true,
      hasAssistantCopyContent: true,
      assistantRevealComplete: true,
    })).toBe("none");
  });

  it("keeps completion controls reserved until the reveal fully settles", () => {
    expect(resolveTurnAssistantFooterMode({
      rowIsLastTurnRow: true,
      turnCompleted: true,
      hasAssistantCopyContent: true,
      assistantRevealComplete: false,
    })).toBe("reserved");
  });
});

describe("recent completed assistant reveal", () => {
  const nowMs = Date.parse("2026-07-18T08:00:00.000Z");

  it("includes atomic short completions inside the reveal window", () => {
    expect(isRecentAssistantCompletion(
      new Date(nowMs - RECENT_ASSISTANT_REVEAL_WINDOW_MS).toISOString(),
      nowMs,
    )).toBe(true);
  });

  it("does not replay hydrated history or future timestamps", () => {
    expect(isRecentAssistantCompletion(
      new Date(nowMs - RECENT_ASSISTANT_REVEAL_WINDOW_MS - 1).toISOString(),
      nowMs,
    )).toBe(false);
    expect(isRecentAssistantCompletion(
      new Date(nowMs + 1).toISOString(),
      nowMs,
    )).toBe(false);
    expect(isRecentAssistantCompletion(null, nowMs)).toBe(false);
  });
});

describe("assistant reveal frontier", () => {
  it("stays claimed while the final word fade is still settling", () => {
    expect(shouldHoldAssistantRevealFrontier({
      itemId: "assistant-item",
      hasUnrevealedText: false,
      cachedRevealComplete: false,
      eligibleOrigin: true,
    })).toBe(true);
  });

  it("releases only a settled frontier with no buffered text", () => {
    expect(shouldHoldAssistantRevealFrontier({
      itemId: "assistant-item",
      hasUnrevealedText: false,
      cachedRevealComplete: true,
      eligibleOrigin: true,
    })).toBe(false);
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
