import { describe, expect, it } from "vitest";
import type { ReviewKind, ReviewRunDetail } from "@anyharness/sdk";
import {
  isReviewRunBlocking,
  reviewRunReplacesStartingReview,
  selectBlockingReviewRun,
  selectComposerReviewRun,
} from "./review-runs";

interface StartingReviewFixture {
  parentSessionId: string;
  kind: ReviewKind;
  maxRounds: number;
  autoIterate: boolean;
  startedAt: number;
}

describe("review run composer selection", () => {
  it("selects a blocking review before terminal notices", () => {
    const terminal = reviewRun({ id: "latest-passed", status: "passed" });
    const blocking = reviewRun({ id: "active-feedback", status: "feedback_ready" });

    expect(selectComposerReviewRun([terminal, blocking], [])).toBe(blocking);
    expect(selectBlockingReviewRun([terminal, blocking])).toBe(blocking);
  });

  it("shows only the latest terminal review as a one-time notice", () => {
    const latest = reviewRun({ id: "latest-passed", status: "passed" });
    const older = reviewRun({ id: "older-stopped", status: "stopped" });

    expect(selectComposerReviewRun([latest, older], [])).toBe(latest);
    expect(selectComposerReviewRun([latest, older], ["latest-passed"])).toBeNull();
  });

  it("does not let older terminal dismissals hide the latest terminal notice", () => {
    const latest = reviewRun({ id: "latest-failed", status: "system_failed" });
    const older = reviewRun({ id: "older-passed", status: "passed" });

    expect(selectComposerReviewRun([latest, older], ["older-passed"])).toBe(latest);
  });

  it("classifies only non-terminal review workflow states as blocking", () => {
    expect(isReviewRunBlocking(reviewRun({ id: "reviewing", status: "reviewing" }))).toBe(true);
    expect(isReviewRunBlocking(reviewRun({ id: "waiting", status: "waiting_for_revision" }))).toBe(true);
    expect(isReviewRunBlocking(reviewRun({ id: "passed", status: "passed" }))).toBe(false);
    expect(isReviewRunBlocking(reviewRun({ id: "stopped", status: "stopped" }))).toBe(false);
  });

  it("lets any blocking server run replace optimistic start state", () => {
    expect(reviewRunReplacesStartingReview(
      reviewRun({
        id: "reviewing",
        status: "reviewing",
        createdAt: "2026-04-29T00:00:00Z",
      }),
      startingReview({ startedAt: Date.parse("2026-04-29T01:00:00Z") }),
    )).toBe(true);
  });

  it("lets a matching newly-created terminal run replace optimistic start state", () => {
    expect(reviewRunReplacesStartingReview(
      reviewRun({
        id: "failed-fast",
        status: "system_failed",
        createdAt: "2026-04-29T01:00:01Z",
      }),
      startingReview({ startedAt: Date.parse("2026-04-29T01:00:00Z") }),
    )).toBe(true);
  });

  it("keeps older terminal notices behind optimistic start state", () => {
    expect(reviewRunReplacesStartingReview(
      reviewRun({
        id: "older-failed",
        status: "system_failed",
        createdAt: "2026-04-29T00:59:59Z",
      }),
      startingReview({ startedAt: Date.parse("2026-04-29T01:00:00Z") }),
    )).toBe(false);
  });

  it("does not let terminal runs for a different review setup replace optimistic start state", () => {
    expect(reviewRunReplacesStartingReview(
      reviewRun({
        id: "plan-failed",
        kind: "plan",
        status: "system_failed",
        createdAt: "2026-04-29T01:00:01Z",
      }),
      startingReview({ startedAt: Date.parse("2026-04-29T01:00:00Z") }),
    )).toBe(false);
  });
});

function reviewRun(
  overrides: Pick<ReviewRunDetail, "id" | "status"> & Partial<ReviewRunDetail>,
): ReviewRunDetail {
  const { id, status, ...rest } = overrides;
  return {
    activeRoundId: null,
    autoIterate: false,
    childSessionIds: [],
    createdAt: "2026-04-29T00:00:00Z",
    currentRoundNumber: 1,
    failureDetail: null,
    failureReason: null,
    id,
    kind: "code",
    maxRounds: 2,
    parentCanSignalRevisionViaMcp: false,
    parentSessionId: "parent-session",
    rounds: [],
    status,
    targetPlanId: null,
    targetPlanSnapshotHash: null,
    title: "Code review",
    updatedAt: "2026-04-29T00:00:00Z",
    workspaceId: "workspace",
    ...rest,
  };
}

function startingReview(overrides: Partial<StartingReviewFixture> = {}): StartingReviewFixture {
  return {
    autoIterate: false,
    kind: "code",
    maxRounds: 2,
    parentSessionId: "parent-session",
    startedAt: Date.parse("2026-04-29T00:00:00Z"),
    ...overrides,
  };
}
