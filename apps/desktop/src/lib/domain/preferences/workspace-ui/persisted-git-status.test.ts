import { describe, expect, it } from "vitest";
import type { PersistedWorkspaceGitStatusSnapshot } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import {
  MAX_PERSISTED_GIT_STATUS_SNAPSHOTS,
  sanitizeGitStatusSnapshotsByWorkspace,
} from "./persisted-git-status";

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
    capturedAt: "2026-07-01T12:00:00.000Z",
    lastPromptAt: null,
    ...overrides,
  };
}

describe("sanitizeGitStatusSnapshotsByWorkspace", () => {
  it("returns an empty record for non-object input", () => {
    expect(sanitizeGitStatusSnapshotsByWorkspace(null)).toEqual({});
    expect(sanitizeGitStatusSnapshotsByWorkspace("nope")).toEqual({});
    expect(sanitizeGitStatusSnapshotsByWorkspace([snapshot()])).toEqual({});
  });

  it("keeps valid entries including null prState (never-available)", () => {
    const input = {
      a: snapshot(),
      b: snapshot({ prState: null, prNumber: null, prUrl: null }),
    };
    expect(sanitizeGitStatusSnapshotsByWorkspace(input)).toEqual(input);
  });

  it("drops malformed entries and unknown enum values", () => {
    const sanitized = sanitizeGitStatusSnapshotsByWorkspace({
      valid: snapshot(),
      unknownState: snapshot({ prState: "reopened" as never }),
      unknownChecks: snapshot({ checks: "amber" as never }),
      unknownReview: snapshot({ reviewDecision: "maybe" as never }),
      badNumber: snapshot({ prNumber: "805" as never }),
      badCapturedAt: snapshot({ capturedAt: "not-a-date" }),
      missingCapturedAt: snapshot({ capturedAt: undefined as never }),
      badPromptAt: snapshot({ lastPromptAt: "garbage" }),
      notAnObject: 42,
    });
    expect(Object.keys(sanitized)).toEqual(["valid"]);
  });

  it("caps entries by capturedAt recency", () => {
    const input: Record<string, PersistedWorkspaceGitStatusSnapshot> = {};
    const total = MAX_PERSISTED_GIT_STATUS_SNAPSHOTS + 25;
    for (let i = 0; i < total; i += 1) {
      input[`ws-${i}`] = snapshot({
        capturedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      });
    }
    const sanitized = sanitizeGitStatusSnapshotsByWorkspace(input);
    expect(Object.keys(sanitized)).toHaveLength(MAX_PERSISTED_GIT_STATUS_SNAPSHOTS);
    // The most recent entries survive; the oldest 25 are dropped.
    expect(sanitized[`ws-${total - 1}`]).toBeDefined();
    expect(sanitized["ws-0"]).toBeUndefined();
    expect(sanitized["ws-24"]).toBeUndefined();
    expect(sanitized["ws-25"]).toBeDefined();
  });
});
