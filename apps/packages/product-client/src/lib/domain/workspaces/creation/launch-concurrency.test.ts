import { describe, expect, it } from "vitest";
import {
  canBeginPendingLaunch,
  countStartingPendingLaunches,
  isDuplicateLaunchSubmit,
  launchSubmitFingerprint,
  MAX_CONCURRENT_PENDING_LAUNCHES,
} from "#product/lib/domain/workspaces/creation/launch-concurrency";
import {
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import type { HomeLaunchTarget } from "#product/lib/domain/home/home-next-launch";

const REPO_A: HomeLaunchTarget = {
  kind: "worktree",
  repoRootId: "repo-root-a",
  sourceWorkspaceId: null,
  baseBranch: "main",
  defaultBranch: "main",
};
const REPO_B: HomeLaunchTarget = { ...REPO_A, repoRootId: "repo-root-b" };

function entry(attemptId: string, stage: PendingWorkspaceEntry["stage"] = "submitting") {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "local-created",
      displayName: attemptId,
      request: { kind: "local", sourceRoot: "/tmp/landing" },
    }),
    stage,
  };
}

describe("pending launch cap", () => {
  it("allows launches up to the cap and refuses the next one", () => {
    const atCap = Array.from(
      { length: MAX_CONCURRENT_PENDING_LAUNCHES },
      (_unused, index) => entry(`attempt-${index}`),
    );

    expect(canBeginPendingLaunch(atCap.slice(0, -1))).toBe(true);
    expect(canBeginPendingLaunch(atCap)).toBe(false);
  });

  it("does not count failed attempts against the cap", () => {
    const failed = Array.from(
      { length: MAX_CONCURRENT_PENDING_LAUNCHES },
      (_unused, index) => entry(`attempt-${index}`, "failed"),
    );

    expect(countStartingPendingLaunches(failed)).toBe(0);
    expect(canBeginPendingLaunch(failed)).toBe(true);
  });

  it("counts an attempt waiting on cloud readiness as starting", () => {
    expect(countStartingPendingLaunches([entry("attempt-1", "awaiting-cloud-ready")])).toBe(1);
  });
});

describe("duplicate launch submit", () => {
  it("collapses the same prompt submitted twice in a keystroke", () => {
    const first = launchSubmitFingerprint("ship it", REPO_A, 1_000);
    const second = launchSubmitFingerprint("  Ship  it ", REPO_A, 1_200);

    expect(isDuplicateLaunchSubmit(first, second)).toBe(true);
  });

  it("keeps two different prompts as two launches", () => {
    const first = launchSubmitFingerprint("ship it", REPO_A, 1_000);
    const second = launchSubmitFingerprint("ship the other thing", REPO_A, 1_001);

    expect(isDuplicateLaunchSubmit(first, second)).toBe(false);
  });

  // PR #1870 review finding 7: the same prompt aimed at two repositories is
  // two launches, however fast the second one follows.
  it("keeps the same prompt sent to two different targets as two launches", () => {
    const first = launchSubmitFingerprint("run the tests", REPO_A, 1_000);
    const second = launchSubmitFingerprint("run the tests", REPO_B, 1_001);

    expect(isDuplicateLaunchSubmit(first, second)).toBe(false);
  });

  it("separates targets of different kinds carrying the same prompt", () => {
    const cloud = launchSubmitFingerprint("run the tests", {
      kind: "cloud",
      gitOwner: "proliferate-ai",
      gitRepoName: "proliferate",
      baseBranch: "main",
    }, 1_000);
    const cowork = launchSubmitFingerprint("run the tests", { kind: "cowork" }, 1_001);

    expect(isDuplicateLaunchSubmit(cloud, cowork)).toBe(false);
  });

  it("lets the same prompt through once the window has passed", () => {
    const first = launchSubmitFingerprint("ship it", REPO_A, 1_000);

    expect(isDuplicateLaunchSubmit(first, launchSubmitFingerprint("ship it", REPO_A, 2_000)))
      .toBe(false);
  });

  it("never treats the first submit as a duplicate", () => {
    expect(isDuplicateLaunchSubmit(null, launchSubmitFingerprint("ship it", REPO_A, 1_000)))
      .toBe(false);
  });
});
