import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gitAheadBehindLabel,
  prNumberLabelFromGitStatus,
  prStatusCompoundLabel,
  prStatusViewFromGitStatus,
  sidebarGitGlyphForStatus,
} from "@/lib/domain/workspaces/git-status/pr-status-presentation";
import type {
  WorkspaceGitStatus,
  WorkspacePrStatus,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";

const NOW = "2026-07-02T12:00:00.000Z";
const THREE_HOURS_AGO = "2026-07-02T09:00:00.000Z";

function pr(overrides: Partial<WorkspacePrStatus> = {}): WorkspacePrStatus {
  return {
    state: "open",
    number: 805,
    url: "https://github.com/acme/repo/pull/805",
    checks: "none",
    reviewDecision: "none",
    ...overrides,
  };
}

function status(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    branch: "feat/statuses",
    dirty: false,
    conflicted: false,
    ahead: null,
    behind: null,
    hasUpstream: true,
    pr: null,
    attention: "none",
    capturedAt: THREE_HOURS_AGO,
    source: "live",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("prStatusViewFromGitStatus", () => {
  it("returns null when PR data is unknown or the status is absent", () => {
    expect(prStatusViewFromGitStatus(null)).toBeNull();
    expect(prStatusViewFromGitStatus(undefined)).toBeNull();
    expect(prStatusViewFromGitStatus(status({ pr: null }))).toBeNull();
  });

  it("returns null for an authoritative no-PR branch (state none)", () => {
    expect(
      prStatusViewFromGitStatus(status({ pr: pr({ state: "none", number: null, url: null }) })),
    ).toBeNull();
  });

  // §3.3 dot matrix.
  it.each([
    ["open + failing checks", pr({ checks: "failing" }), "checks_failing"],
    [
      "open + failing checks beats changes requested",
      pr({ checks: "failing", reviewDecision: "changes_requested" }),
      "checks_failing",
    ],
    ["open + pending checks", pr({ checks: "pending" }), "pending"],
    [
      "open + pending checks beats changes requested",
      pr({ checks: "pending", reviewDecision: "changes_requested" }),
      "pending",
    ],
    [
      "open + passing checks + changes requested",
      pr({ checks: "passing", reviewDecision: "changes_requested" }),
      "changes_requested",
    ],
    [
      "open + no checks + changes requested",
      pr({ reviewDecision: "changes_requested" }),
      "changes_requested",
    ],
    ["open + passing + approved", pr({ checks: "passing", reviewDecision: "approved" }), "open"],
    ["open + no checks/review", pr(), "open"],
    ["draft regardless of checks", pr({ state: "draft", checks: "failing" }), "draft"],
    ["merged regardless of checks", pr({ state: "merged", checks: "failing" }), "merged"],
    ["closed", pr({ state: "closed" }), "closed"],
  ])("maps %s", (_label, prStatus, expectedKind) => {
    const view = prStatusViewFromGitStatus(status({ pr: prStatus }));
    expect(view?.kind).toBe(expectedKind);
  });

  it("carries the PR number and the compound label", () => {
    const composed = status({ pr: pr({ checks: "failing" }) });
    const view = prStatusViewFromGitStatus(composed);
    expect(view?.number).toBe(805);
    expect(view?.label).toBe("PR #805 · Open · Checks failing");
  });
});

describe("prStatusCompoundLabel", () => {
  it("returns null when there is no PR to describe", () => {
    expect(prStatusCompoundLabel(null)).toBeNull();
    expect(prStatusCompoundLabel(status({ pr: null }))).toBeNull();
    expect(prStatusCompoundLabel(status({ pr: pr({ state: "none" }) }))).toBeNull();
  });

  it("builds 'PR #805 · Open · Checks failing'", () => {
    expect(prStatusCompoundLabel(status({ pr: pr({ checks: "failing" }) })))
      .toBe("PR #805 · Open · Checks failing");
  });

  it("includes checks and review on draft rows", () => {
    expect(
      prStatusCompoundLabel(status({
        pr: pr({ state: "draft", checks: "failing", reviewDecision: "changes_requested" }),
      })),
    ).toBe("PR #805 · Draft · Checks failing · Changes requested");
  });

  it("includes review qualifiers on open rows", () => {
    expect(prStatusCompoundLabel(status({ pr: pr({ reviewDecision: "approved" }) })))
      .toBe("PR #805 · Open · Approved");
    expect(prStatusCompoundLabel(status({ pr: pr({ reviewDecision: "changes_requested" }) })))
      .toBe("PR #805 · Open · Changes requested");
  });

  it("keeps merged/closed labels terminal (no checks/review)", () => {
    expect(
      prStatusCompoundLabel(status({
        pr: pr({ state: "merged", checks: "failing", reviewDecision: "changes_requested" }),
      })),
    ).toBe("PR #805 · Merged");
    expect(prStatusCompoundLabel(status({ pr: pr({ state: "closed" }) })))
      .toBe("PR #805 · Closed");
  });

  it("omits the number when unknown", () => {
    expect(prStatusCompoundLabel(status({ pr: pr({ number: null }) }))).toBe("PR · Open");
  });

  it("appends 'as of {rel}' for snapshot-sourced statuses", () => {
    expect(
      prStatusCompoundLabel(status({
        pr: pr(),
        source: "snapshot",
        capturedAt: THREE_HOURS_AGO,
      })),
    ).toBe("PR #805 · Open · as of 3h ago");
  });
});

describe("sidebarGitGlyphForStatus", () => {
  it("returns null when there is no git data", () => {
    expect(sidebarGitGlyphForStatus(null)).toBeNull();
    expect(sidebarGitGlyphForStatus(status({ branch: null, pr: null }))).toBeNull();
  });

  it("prefers the pull-request glyph with the compound tooltip", () => {
    const glyph = sidebarGitGlyphForStatus(status({ pr: pr() }));
    expect(glyph).toEqual({
      kind: "pull_request",
      conflicted: false,
      tooltip: "PR #805 · Open",
    });
  });

  it("falls back to the branch glyph for authoritative no-PR and unknown PR", () => {
    expect(sidebarGitGlyphForStatus(status({ pr: pr({ state: "none" }) }))?.kind).toBe("branch");
    expect(sidebarGitGlyphForStatus(status({ pr: null }))?.kind).toBe("branch");
  });

  it("marks conflicts with the conflict tooltip", () => {
    const glyph = sidebarGitGlyphForStatus(status({ pr: pr(), attention: "conflicts" }));
    expect(glyph?.conflicted).toBe(true);
    expect(glyph?.tooltip).toBe("Merge conflicts in worktree");
  });
});

describe("prNumberLabelFromGitStatus", () => {
  it("renders '#805' when a PR exists", () => {
    expect(prNumberLabelFromGitStatus(status({ pr: pr() }))).toBe("#805");
  });

  it("returns null without a PR, without a number, or for state none", () => {
    expect(prNumberLabelFromGitStatus(null)).toBeNull();
    expect(prNumberLabelFromGitStatus(status({ pr: null }))).toBeNull();
    expect(prNumberLabelFromGitStatus(status({ pr: pr({ number: null }) }))).toBeNull();
    expect(prNumberLabelFromGitStatus(status({ pr: pr({ state: "none" }) }))).toBeNull();
  });
});

describe("gitAheadBehindLabel", () => {
  it("returns null when neither side is ahead", () => {
    expect(gitAheadBehindLabel(null)).toBeNull();
    expect(gitAheadBehindLabel(status())).toBeNull();
    expect(gitAheadBehindLabel(status({ ahead: 0, behind: 0 }))).toBeNull();
  });

  it("renders one or both directions", () => {
    expect(gitAheadBehindLabel(status({ ahead: 2, behind: 1 }))).toBe("↑2 ↓1");
    expect(gitAheadBehindLabel(status({ ahead: 2, behind: 0 }))).toBe("↑2");
    expect(gitAheadBehindLabel(status({ ahead: 0, behind: 3 }))).toBe("↓3");
  });
});
