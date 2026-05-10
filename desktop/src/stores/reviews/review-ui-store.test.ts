import { beforeEach, describe, expect, it } from "vitest";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";

describe("review ui store", () => {
  beforeEach(() => {
    useReviewUiStore.setState({
      setup: null,
      critiqueTarget: null,
      startingReview: null,
      dismissedTerminalNoticeRunIds: [],
    });
  });

  it("patches and clears a starting review with the same token", () => {
    useReviewUiStore.getState().beginStartingReview({
      parentSessionId: "client-session:codex:1",
      kind: "code",
      maxRounds: 1,
      autoIterate: false,
      reviewers: [],
      startedAt: 123,
    });

    expect(useReviewUiStore.getState().patchStartingReviewParentSession(
      { kind: "code", startedAt: 123 },
      "runtime-session-1",
    )).toBe(true);
    expect(useReviewUiStore.getState().startingReview?.parentSessionId)
      .toBe("runtime-session-1");
    expect(useReviewUiStore.getState().clearStartingReviewForToken({
      kind: "code",
      startedAt: 123,
    }))
      .toBe(true);
    expect(useReviewUiStore.getState().startingReview).toBeNull();
  });

  it("ignores stale starting review tokens", () => {
    useReviewUiStore.getState().beginStartingReview({
      parentSessionId: "client-session:codex:1",
      kind: "code",
      maxRounds: 1,
      autoIterate: false,
      reviewers: [],
      startedAt: 123,
    });

    expect(useReviewUiStore.getState().patchStartingReviewParentSession(
      { kind: "code", startedAt: 122 },
      "runtime-session-1",
    )).toBe(false);
    expect(useReviewUiStore.getState().patchStartingReviewParentSession(
      { kind: "plan", startedAt: 123 },
      "runtime-session-1",
    )).toBe(false);
    expect(useReviewUiStore.getState().startingReview?.parentSessionId)
      .toBe("client-session:codex:1");
  });
});
