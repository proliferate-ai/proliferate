import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@anyharness/sdk";
import {
  buildWorkspaceStatusModel,
  type WorkspaceStatusModelInput,
} from "./workspace-status-model";

const NOW_MS = 1_784_000_000_000;

function gitStatus(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    repoRootPath: "/tmp/repo",
    currentBranch: "feature/status",
    headOid: "abc",
    detached: false,
    upstreamBranch: "origin/feature/status",
    suggestedBaseBranch: "main",
    ahead: 2,
    behind: 0,
    operation: "none",
    conflicted: false,
    clean: false,
    summary: {
      changedFiles: 12,
      additions: 100,
      deletions: 20,
      includedFiles: 3,
      conflictedFiles: 0,
    },
    actions: {
      canCommit: true,
      canPush: true,
      pushLabel: "Push",
      canCreatePullRequest: true,
      canCreateDraftPullRequest: true,
      canCreateBranchWorkspace: false,
    },
    files: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<WorkspaceStatusModelInput> = {}): WorkspaceStatusModelInput {
  return {
    gitStatus: gitStatus(),
    pullRequest: {
      number: 1042,
      state: "open",
      checks: "failing",
      reviewDecision: "none",
    },
    hasExistingPullRequest: true,
    agents: [],
    activity: { agents: [], loops: [], processes: [] },
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe("buildWorkspaceStatusModel", () => {
  it("composes the environment rows from git status and the PR", () => {
    const model = buildWorkspaceStatusModel(baseInput());

    expect(model?.environment).toEqual({
      reviewChangesLabel: "Review 12 changes",
      commitOrPushLabel: "Commit or push",
      commitOrPushMeta: "2 ahead",
      commitOrPushDisabled: false,
      compareLabel: "Compare branch",
      compareMeta: "PR #1042",
      checks: {
        label: "Checks failing",
        state: "failing",
        actionLabel: "View",
        items: [],
      },
    });
  });

  it("hides checks without a PR and PR meta without an existing PR", () => {
    const model = buildWorkspaceStatusModel(baseInput({
      pullRequest: null,
      hasExistingPullRequest: false,
    }));

    expect(model?.environment?.checks).toBeNull();
    expect(model?.environment?.compareMeta).toBeNull();
    expect(model?.environment?.reviewChangesLabel).toBe("Review 12 changes");
  });

  it("labels a clean tree as No changes", () => {
    const model = buildWorkspaceStatusModel(baseInput({
      gitStatus: gitStatus({
        ahead: 0,
        summary: {
          changedFiles: 0,
          additions: 0,
          deletions: 0,
          includedFiles: 0,
          conflictedFiles: 0,
        },
      }),
      pullRequest: null,
      hasExistingPullRequest: false,
    }));

    expect(model?.environment?.reviewChangesLabel).toBe("No changes");
    expect(model?.environment?.commitOrPushMeta).toBeNull();
    expect(model?.environment?.commitOrPushDisabled).toBe(true);
  });

  it("buckets our agents by working state and keeps session targets", () => {
    const model = buildWorkspaceStatusModel(baseInput({
      agents: [
        { key: "a", name: "Epicurus", sessionId: "s-1", working: true },
        { key: "b", name: "Review · Darwin", sessionId: "s-2", working: false },
      ],
    }));

    expect(model?.subagents.working).toEqual([
      { key: "a", name: "Epicurus", sessionId: "s-1", tintClassName: undefined },
    ]);
    expect(model?.subagents.done).toEqual([
      { key: "b", name: "Review · Darwin", sessionId: "s-2", tintClassName: undefined },
    ]);
  });

  it("maps native activity into count rows with hover items", () => {
    const model = buildWorkspaceStatusModel(baseInput({
      activity: {
        agents: [
          {
            id: "agent-1",
            agentType: "task",
            description: "Explore auth boundary",
            model: null,
            background: true,
            status: { status: "running" },
            usage: { tokensUsed: null, toolCalls: null, durationSeconds: 720 },
            feed: null,
          },
        ],
        loops: [
          {
            loopId: "loop-1",
            prompt: "Watch CI and report failures",
            schedule: { kind: "interval", expr: "5m" },
            recurring: true,
            status: "active",
            native: true,
            lastFiredAtMs: NOW_MS - 2 * 60_000,
            fireCount: 3,
            updatedAtMs: NOW_MS - 2 * 60_000,
          },
        ],
        processes: [
          {
            id: "proc-1",
            command: "pnpm dev",
            cwd: null,
            status: { status: "running" },
            pid: null,
            startedAt: new Date(NOW_MS - 38 * 60_000).toISOString(),
            endedAt: null,
            feed: null,
          },
          {
            id: "proc-2",
            command: "cargo test",
            cwd: null,
            status: { status: "exited", exitCode: 1 },
            pid: null,
            startedAt: new Date(NOW_MS - 20 * 60_000).toISOString(),
            endedAt: new Date(NOW_MS - 14 * 60_000).toISOString(),
            feed: null,
          },
        ],
      },
    }));

    const byKind = new Map(model?.native.map((row) => [row.kind, row]));
    expect(byKind.get("agents")?.label).toBe("1 subagent");
    expect(byKind.get("agents")?.meta).toBe("1 running");
    expect(byKind.get("agents")?.items[0]?.state).toBe("working");

    expect(byKind.get("terminals")?.label).toBe("2 terminals");
    expect(byKind.get("terminals")?.items.map((item) => item.state)).toEqual([
      "working",
      "failing",
    ]);

    expect(byKind.get("loops")?.label).toBe("1 loop");
    expect(byKind.get("loops")?.meta).toBe("next in 3m");
    expect(byKind.get("loops")?.items[0]?.name).toBe("Watch CI and report failures");
  });

  it("returns null when there is nothing to show", () => {
    expect(buildWorkspaceStatusModel(baseInput({
      gitStatus: null,
      pullRequest: null,
      hasExistingPullRequest: false,
    }))).toBeNull();
  });
});
