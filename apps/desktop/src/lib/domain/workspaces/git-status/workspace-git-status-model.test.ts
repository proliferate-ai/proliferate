import type { BranchPullRequestStatus } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  composeWorkspaceGitStatus,
  deriveGitAttention,
  gitStatusFromSnapshot,
  isTimestampNewer,
  pathsEqualCanonical,
  workspaceGitStatusesMateriallyEqual,
  type ComposeWorkspaceGitStatusInput,
  type PersistedWorkspaceGitStatusSnapshot,
  type WorkspacePrStatus,
} from "./workspace-git-status-model";
import {
  gitStatusSnapshotsMateriallyEqual,
  persistedSnapshotFromPullRequestSummary,
  persistedSnapshotFromStatus,
  planGitStatusSnapshotWrite,
} from "./workspace-git-status-snapshots";

const NOW = "2026-07-01T12:00:00.000Z";
const EARLIER = "2026-07-01T11:00:00.000Z";
const LATER = "2026-07-01T13:00:00.000Z";

function prEntry(overrides?: {
  headBranch?: string;
  state?: "open" | "closed" | "merged";
  draft?: boolean;
  checks?: "none" | "pending" | "passing" | "failing" | null;
  reviewDecision?: "none" | "approved" | "changes_requested" | null;
}): BranchPullRequestStatus {
  return {
    headBranch: overrides?.headBranch ?? "feature",
    pullRequest: {
      number: 805,
      title: "Feature",
      url: "https://github.com/o/r/pull/805",
      state: overrides?.state ?? "open",
      draft: overrides?.draft ?? false,
      headBranch: overrides?.headBranch ?? "feature",
      baseBranch: "main",
      checks: overrides?.checks,
      reviewDecision: overrides?.reviewDecision,
    },
  };
}

function snapshot(
  overrides?: Partial<PersistedWorkspaceGitStatusSnapshot>,
): PersistedWorkspaceGitStatusSnapshot {
  return {
    branch: "feature",
    prState: "open",
    prNumber: 805,
    prUrl: "https://github.com/o/r/pull/805",
    checks: "passing",
    reviewDecision: "none",
    capturedAt: NOW,
    lastPromptAt: null,
    ...overrides,
  };
}

function composeInput(
  overrides?: Partial<ComposeWorkspaceGitStatusInput>,
): ComposeWorkspaceGitStatusInput {
  return {
    branch: "feature",
    worktreeSummary: null,
    prEntry: null,
    prAvailability: null,
    prFetchedAt: null,
    snapshot: null,
    now: NOW,
    ...overrides,
  };
}

describe("deriveGitAttention", () => {
  const failingPr: WorkspacePrStatus = {
    state: "open",
    number: 1,
    url: null,
    checks: "failing",
    reviewDecision: "changes_requested",
  };

  it("orders conflicts > ci_failing > changes_requested > none", () => {
    expect(deriveGitAttention({ conflicted: true, pr: failingPr })).toBe("conflicts");
    expect(deriveGitAttention({ conflicted: false, pr: failingPr })).toBe("ci_failing");
    expect(deriveGitAttention({
      conflicted: null,
      pr: { ...failingPr, checks: "passing" },
    })).toBe("changes_requested");
    expect(deriveGitAttention({
      conflicted: null,
      pr: { ...failingPr, checks: "none", reviewDecision: "approved" },
    })).toBe("none");
    expect(deriveGitAttention({ conflicted: null, pr: null })).toBe("none");
  });
});

describe("pathsEqualCanonical", () => {
  it("normalizes the macOS /private prefix and trailing slashes", () => {
    expect(pathsEqualCanonical("/private/var/repo", "/var/repo")).toBe(true);
    expect(pathsEqualCanonical("/var/repo/", "/var/repo")).toBe(true);
    expect(pathsEqualCanonical("/private/var/a", "/var/b")).toBe(false);
    expect(pathsEqualCanonical(null, "/var/repo")).toBe(false);
    expect(pathsEqualCanonical("/privateer/repo", "/eer/repo")).toBe(false);
  });
});

describe("isTimestampNewer", () => {
  it("compares parseable timestamps and treats invalid candidates as older", () => {
    expect(isTimestampNewer(LATER, NOW)).toBe(true);
    expect(isTimestampNewer(NOW, NOW)).toBe(false);
    expect(isTimestampNewer(null, NOW)).toBe(false);
    expect(isTimestampNewer(NOW, null)).toBe(true);
  });
});

describe("composeWorkspaceGitStatus", () => {
  it("maps a live queried PR entry authoritatively", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      prEntry: prEntry({ checks: "failing", reviewDecision: "changes_requested" }),
      prAvailability: "ok",
      prFetchedAt: NOW,
    }));
    expect(status.pr).toEqual({
      state: "open",
      number: 805,
      url: "https://github.com/o/r/pull/805",
      checks: "failing",
      reviewDecision: "changes_requested",
    });
    expect(status.attention).toBe("ci_failing");
    expect(status.source).toBe("live");
    expect(status.capturedAt).toBe(NOW);
  });

  it("maps open draft PRs to the draft state and absent rollups to none", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      prEntry: prEntry({ draft: true, checks: null, reviewDecision: null }),
      prAvailability: "ok",
      prFetchedAt: NOW,
    }));
    expect(status.pr?.state).toBe("draft");
    expect(status.pr?.checks).toBe("none");
    expect(status.pr?.reviewDecision).toBe("none");
  });

  it("treats a branch present with null PR as authoritative none", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      prEntry: { headBranch: "feature", pullRequest: null },
      prAvailability: "ok",
      prFetchedAt: LATER,
      snapshot: snapshot({ capturedAt: EARLIER }),
    }));
    expect(status.pr?.state).toBe("none");
    expect(status.source).toBe("live");
  });

  it("keeps the snapshot when the branch is absent from the fetched entries", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      prEntry: null,
      prAvailability: "ok",
      prFetchedAt: LATER,
      snapshot: snapshot({ capturedAt: EARLIER }),
    }));
    expect(status.pr?.state).toBe("open");
    expect(status.pr?.number).toBe(805);
    expect(status.source).toBe("snapshot");
    expect(status.capturedAt).toBe(EARLIER);
  });

  it("keeps the snapshot on unavailability instead of conflating with none", () => {
    for (const availability of [
      "gh_not_installed",
      "gh_auth_required",
      "remote_unsupported",
      "endpoint_missing",
      "error",
      null,
    ] as const) {
      const status = composeWorkspaceGitStatus(composeInput({
        prEntry: prEntry(),
        prAvailability: availability,
        prFetchedAt: LATER,
        snapshot: snapshot(),
      }));
      expect(status.pr?.state).toBe("open");
      expect(status.source).toBe("snapshot");
    }
  });

  it("composes pr null when PR data is unknown and no snapshot exists", () => {
    const status = composeWorkspaceGitStatus(composeInput());
    expect(status.pr).toBeNull();
    expect(status.source).toBe("live");
  });

  it("never lets an older fetch overwrite a newer snapshot (monotonic)", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      prEntry: { headBranch: "feature", pullRequest: null },
      prAvailability: "ok",
      prFetchedAt: EARLIER,
      snapshot: snapshot({ capturedAt: LATER, prState: "merged" }),
    }));
    expect(status.pr?.state).toBe("merged");
    expect(status.source).toBe("snapshot");
    expect(status.capturedAt).toBe(LATER);
  });

  it("drops snapshot PR fields when the snapshot branch mismatches", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      branch: "other-branch",
      snapshot: snapshot({ branch: "feature" }),
    }));
    expect(status.pr).toBeNull();
    expect(status.branch).toBe("other-branch");
  });

  it("maps the worktree summary and nulls unknown summaries", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      worktreeSummary: {
        state: "conflicted",
        conflicted: true,
        ahead: 2,
        behind: 1,
        upstreamBranch: "origin/feature",
      },
    }));
    expect(status.dirty).toBe(true);
    expect(status.conflicted).toBe(true);
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
    expect(status.hasUpstream).toBe(true);
    expect(status.attention).toBe("conflicts");

    const unknown = composeWorkspaceGitStatus(composeInput({
      worktreeSummary: {
        state: "unknown",
        conflicted: false,
        ahead: 0,
        behind: 0,
      },
    }));
    expect(unknown.dirty).toBeNull();
    expect(unknown.conflicted).toBeNull();
    expect(unknown.ahead).toBeNull();
    expect(unknown.behind).toBeNull();
    expect(unknown.hasUpstream).toBeNull();
  });
});

describe("gitStatusFromSnapshot", () => {
  it("hydrates snapshot PR fields with the runtime branch", () => {
    const status = gitStatusFromSnapshot(snapshot(), "feature");
    expect(status.source).toBe("snapshot");
    expect(status.branch).toBe("feature");
    expect(status.pr?.number).toBe(805);
    expect(status.dirty).toBeNull();
  });

  it("drops PR fields when the runtime branch mismatches", () => {
    const status = gitStatusFromSnapshot(snapshot(), "another");
    expect(status.branch).toBe("another");
    expect(status.pr).toBeNull();
  });

  it("hydrates pr null for never-available snapshots", () => {
    const status = gitStatusFromSnapshot(
      snapshot({ prState: null, prNumber: null, prUrl: null }),
      "feature",
    );
    expect(status.pr).toBeNull();
  });
});

describe("planGitStatusSnapshotWrite", () => {
  it("records live PR fields when recordable", () => {
    const next = planGitStatusSnapshotWrite({
      previous: null,
      branch: "feature",
      prEntry: prEntry({ checks: "pending" }),
      prRecordable: true,
      prFetchedAt: NOW,
    });
    expect(next).toEqual(snapshot({ checks: "pending" }));
  });

  it("does not create a snapshot before PR data was ever available", () => {
    expect(planGitStatusSnapshotWrite({
      previous: null,
      branch: "feature",
      prEntry: null,
      prRecordable: false,
      prFetchedAt: null,
    })).toBeNull();
  });

  it("preserves PR fields on unavailability while updating the branch", () => {
    const next = planGitStatusSnapshotWrite({
      previous: snapshot({ branch: null }),
      branch: "feature",
      prEntry: null,
      prRecordable: false,
      prFetchedAt: null,
    });
    expect(next?.branch).toBe("feature");
    expect(next?.prState).toBe("open");
    expect(next?.prNumber).toBe(805);
  });

  it("drops preserved PR fields when the branch changed", () => {
    const next = planGitStatusSnapshotWrite({
      previous: snapshot(),
      branch: "other",
      prEntry: null,
      prRecordable: false,
      prFetchedAt: null,
    });
    expect(next?.branch).toBe("other");
    expect(next?.prState).toBeNull();
  });

  it("never records from data older than the stored snapshot (monotonic)", () => {
    expect(planGitStatusSnapshotWrite({
      previous: snapshot({ capturedAt: LATER }),
      branch: "feature",
      prEntry: { headBranch: "feature", pullRequest: null },
      prRecordable: true,
      prFetchedAt: EARLIER,
    })).toBeNull();
  });

  it("returns null for timestamp-only refreshes (material-change gate)", () => {
    expect(planGitStatusSnapshotWrite({
      previous: snapshot({ capturedAt: EARLIER }),
      branch: "feature",
      prEntry: prEntry({ checks: "passing" }),
      prRecordable: true,
      prFetchedAt: NOW,
    })).toBeNull();
  });

  it("preserves lastPromptAt across recorded updates", () => {
    const next = planGitStatusSnapshotWrite({
      previous: snapshot({ capturedAt: EARLIER, lastPromptAt: EARLIER }),
      branch: "feature",
      prEntry: prEntry({ state: "merged" }),
      prRecordable: true,
      prFetchedAt: NOW,
    });
    expect(next?.prState).toBe("merged");
    expect(next?.lastPromptAt).toBe(EARLIER);
  });
});

describe("persistedSnapshotFromStatus", () => {
  it("captures the composed status with the prompt stamp", () => {
    const status = composeWorkspaceGitStatus(composeInput({
      prEntry: prEntry(),
      prAvailability: "ok",
      prFetchedAt: NOW,
    }));
    const captured = persistedSnapshotFromStatus({
      status,
      previous: null,
      lastPromptAt: NOW,
    });
    expect(captured).toEqual(snapshot({ checks: "none", lastPromptAt: NOW }));
  });

  it("preserves previous PR fields when the status has unknown PR data", () => {
    const status = composeWorkspaceGitStatus(composeInput());
    const captured = persistedSnapshotFromStatus({
      status,
      previous: snapshot({ capturedAt: EARLIER }),
      lastPromptAt: NOW,
    });
    expect(captured.prState).toBe("open");
    expect(captured.capturedAt).toBe(EARLIER);
    expect(captured.lastPromptAt).toBe(NOW);
  });
});

describe("persistedSnapshotFromPullRequestSummary", () => {
  it("persists a created PR identity and keeps lastPromptAt", () => {
    const entry = prEntry({ draft: true });
    const captured = persistedSnapshotFromPullRequestSummary({
      summary: entry.pullRequest!,
      previous: snapshot({ lastPromptAt: EARLIER }),
      capturedAt: NOW,
    });
    expect(captured.prState).toBe("draft");
    expect(captured.prNumber).toBe(805);
    expect(captured.branch).toBe("feature");
    expect(captured.lastPromptAt).toBe(EARLIER);
  });
});

describe("material equality", () => {
  it("ignores capturedAt for render statuses", () => {
    const a = composeWorkspaceGitStatus(composeInput({
      prEntry: prEntry(),
      prAvailability: "ok",
      prFetchedAt: NOW,
    }));
    const b = composeWorkspaceGitStatus(composeInput({
      prEntry: prEntry(),
      prAvailability: "ok",
      prFetchedAt: LATER,
    }));
    expect(workspaceGitStatusesMateriallyEqual(a, b)).toBe(true);

    const c = composeWorkspaceGitStatus(composeInput({
      prEntry: prEntry({ state: "merged" }),
      prAvailability: "ok",
      prFetchedAt: LATER,
    }));
    expect(workspaceGitStatusesMateriallyEqual(a, c)).toBe(false);
  });

  it("compares snapshot material fields including lastPromptAt", () => {
    expect(gitStatusSnapshotsMateriallyEqual(
      snapshot({ capturedAt: EARLIER }),
      snapshot({ capturedAt: LATER }),
    )).toBe(true);
    expect(gitStatusSnapshotsMateriallyEqual(
      snapshot(),
      snapshot({ lastPromptAt: NOW }),
    )).toBe(false);
  });
});
