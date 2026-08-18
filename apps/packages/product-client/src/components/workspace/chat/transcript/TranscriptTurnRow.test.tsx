import { describe, expect, it } from "vitest";
import {
  resolveTurnAssistantFooterMode,
  resolveTurnFrontierStatusMode,
  resolveTranscriptTurnDiffPanelKind,
  shouldRenderAssistantEndResource,
  shouldRenderStandaloneStoppedNotice,
} from "#product/domain/chats/transcript/turn-row-presentation";
import {
  isRecentAssistantCompletion,
  RECENT_ASSISTANT_REVEAL_WINDOW_MS,
  shouldHoldAssistantRevealFrontier,
} from "#product/hooks/chat/ui/use-assistant-reveal-frontier";
import { resolveCompletedHistoryDisclosureLabel } from "#product/components/workspace/chat/transcript/TranscriptTurnChrome";

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

describe("frontier status box", () => {
  const base = {
    hasTrailingStatus: false,
    rowIsLastTurnRow: true,
    isLatestTurnInProgress: true,
    turnIsActivelyStreaming: true,
    assistantRevealComplete: true,
  };

  it("keeps the box reserved through mid-turn status gaps so the transcript bottom cannot bounce", () => {
    expect(resolveTurnFrontierStatusMode(base)).toBe("reserved");
    expect(resolveTurnFrontierStatusMode({ ...base, hasTrailingStatus: true })).toBe("status");
    // Yield to a tool shimmer and return: reserved both times, never unmounted.
    expect(resolveTurnFrontierStatusMode({ ...base, hasTrailingStatus: false })).toBe("reserved");
  });

  it("hides the box once the turn is no longer live", () => {
    expect(resolveTurnFrontierStatusMode({ ...base, isLatestTurnInProgress: false })).toBe("hidden");
    expect(resolveTurnFrontierStatusMode({ ...base, rowIsLastTurnRow: false })).toBe("hidden");
  });

  it("yields the frontier entirely to a streaming assistant reveal", () => {
    expect(resolveTurnFrontierStatusMode({ ...base, assistantRevealComplete: false })).toBe("hidden");
    expect(resolveTurnFrontierStatusMode({
      ...base,
      assistantRevealComplete: false,
      hasTrailingStatus: true,
    })).toBe("hidden");
  });

  it("hides the reserve on a dropped-tail wake turn once the session goes idle (R5)", () => {
    // The runtime drops the wake turn's completion tail, so isLatestTurnInProgress
    // stays true forever; only genuine stream liveness may reserve the band. An
    // idle session (turnIsActivelyStreaming false) must resolve "hidden" so no
    // dead ~44-56px gap sits between the settled prose and the timestamp footer.
    expect(resolveTurnFrontierStatusMode({
      ...base,
      turnIsActivelyStreaming: false,
    })).toBe("hidden");
  });

  it("keeps the reserve while the latest turn is genuinely streaming (working)", () => {
    // isLatestTurnInProgress AND turnIsActivelyStreaming both true: unchanged
    // anti-jitter reserve through the whole live turn.
    expect(resolveTurnFrontierStatusMode({
      ...base,
      isLatestTurnInProgress: true,
      turnIsActivelyStreaming: true,
    })).toBe("reserved");
  });

  it("shows a real trailing status regardless of liveness (e.g. a needs_input pause)", () => {
    // A permission-pause turn is not actively streaming, but its interaction
    // indicator is a trailing status, so "status" wins before the reserve branch.
    expect(resolveTurnFrontierStatusMode({
      ...base,
      hasTrailingStatus: true,
      turnIsActivelyStreaming: false,
    })).toBe("status");
  });
});

describe("assistant end resource placement", () => {
  it("renders a linked Markdown resource only after the final completed row", () => {
    expect(shouldRenderAssistantEndResource({
      rowIsLastTurnRow: false,
      visualTurnCompleted: true,
      hasResource: true,
    })).toBe(false);
    expect(shouldRenderAssistantEndResource({
      rowIsLastTurnRow: true,
      visualTurnCompleted: false,
      hasResource: true,
    })).toBe(false);
    expect(shouldRenderAssistantEndResource({
      rowIsLastTurnRow: true,
      visualTurnCompleted: true,
      hasResource: true,
    })).toBe(true);
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
