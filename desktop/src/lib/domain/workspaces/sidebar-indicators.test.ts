import { describe, expect, it } from "vitest";
import type { WorkspaceExecutionSummary } from "@anyharness/sdk";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import { cloudWorkspaceSyntheticId } from "./cloud-ids";
import {
  buildGroups,
  makeCloudLogicalWorkspace,
  makeCloudWorkspace,
  makeLocalLogicalWorkspace,
  makeWorkspace,
} from "./sidebar-test-fixtures";

function workspaceExecutionSummary(
  phase: WorkspaceExecutionSummary["phase"],
  overrides: Partial<WorkspaceExecutionSummary> = {},
): WorkspaceExecutionSummary {
  return {
    phase,
    totalSessionCount: 1,
    liveSessionCount: phase === "idle" || phase === "errored" ? 0 : 1,
    runningCount: phase === "running" ? 1 : 0,
    awaitingInteractionCount: phase === "awaiting_interaction" ? 1 : 0,
    idleCount: phase === "idle" ? 1 : 0,
    erroredCount: phase === "errored" ? 1 : 0,
    ...overrides,
  };
}

describe("sidebar indicators", () => {
  it("uses legacy local automation provenance when creator context is missing", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "automation-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "automation/issue-triage-fd253849c4fe4ec9",
          origin: { kind: "system", entrypoint: "desktop" },
        }),
      ],
    });

    expect(groups[0]?.items[0]?.detailIndicators.map((indicator) => indicator.kind))
      .toEqual(["automation", "materialization"]);
  });

  it("does not infer automation provenance for human automation-prefixed local branches", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "human-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "automation/issue-triage-fd253849c4fe4ec9",
          origin: { kind: "human", entrypoint: "desktop" },
        }),
      ],
    });

    expect(groups[0]?.items[0]?.detailIndicators.map((indicator) => indicator.kind))
      .toEqual(["materialization"]);
  });

  it("does not infer automation provenance for non-automation local system worktrees", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "system-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "feature/issue-triage",
          origin: { kind: "system", entrypoint: "desktop" },
        }),
      ],
    });

    expect(groups[0]?.items[0]?.detailIndicators.map((indicator) => indicator.kind))
      .toEqual(["materialization"]);
  });

  it("uses legacy cloud automation provenance when creator context is missing", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeCloudLogicalWorkspace({
          id: "automation-cloud",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          origin: { kind: "system", entrypoint: "cloud" },
        }),
      ],
    });

    expect(groups[0]?.items[0]?.detailIndicators.map((indicator) => indicator.kind))
      .toEqual(["automation", "materialization"]);
  });

  it("prefers precise automation creator context over legacy provenance", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "automation-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "feature/automation-created",
          origin: { kind: "human", entrypoint: "desktop" },
          creatorContext: {
            kind: "automation",
            automationId: "automation-1",
            automationRunId: "run-1",
            label: "Daily cleanup",
          },
        }),
      ],
    });

    const automationIndicator = groups[0]?.items[0]?.detailIndicators[0];
    expect(automationIndicator).toMatchObject({
      kind: "automation",
      action: {
        kind: "open_automations",
        automationId: "automation-1",
        automationRunId: "run-1",
      },
    });
  });

  it("links agent provenance to the parent session workspace, not the base source workspace", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "agent-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          creatorContext: {
            kind: "agent",
            sourceSessionId: "parent-session-1",
            sourceSessionWorkspaceId: "parent-workspace-1",
            sourceWorkspaceId: "base-workspace-1",
            sessionLinkId: null,
            label: "Cowork thread",
          },
        }),
      ],
    });

    const agentIndicator = groups[0]?.items[0]?.detailIndicators[0];
    expect(agentIndicator).toMatchObject({
      kind: "agent",
      action: {
        kind: "open_source_session",
        workspaceId: "parent-workspace-1",
        sessionId: "parent-session-1",
      },
    });
  });

  it("does not create a precise agent link when parent workspace context is missing", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "agent-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          creatorContext: {
            kind: "agent",
            sourceSessionId: "parent-session-1",
            sourceSessionWorkspaceId: null,
            sourceWorkspaceId: "base-workspace-1",
            sessionLinkId: null,
            label: "Cowork thread",
          },
        }),
      ],
    });

    expect(groups[0]?.items[0]?.detailIndicators[0]).toMatchObject({
      kind: "agent",
      action: null,
    });
  });

  it("follows the effective materialization for dual local/cloud provenance", () => {
    const localWorkspace = makeWorkspace({
      id: "dual-local-materialization",
      repoName: "repo-a",
      sourceRoot: "/tmp/repo-a",
      kind: "worktree",
      branch: "automation/issue-triage-fd253849c4fe4ec9",
      origin: { kind: "system", entrypoint: "desktop" },
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "dual-cloud-materialization",
      repoName: "repo-a",
      branch: "feature/issue-triage",
      origin: { kind: "human", entrypoint: "cloud" },
    });
    const base = makeLocalLogicalWorkspace({
      id: "dual-local-effective",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      kind: "worktree",
      branch: "automation/issue-triage-fd253849c4fe4ec9",
      origin: { kind: "system", entrypoint: "desktop" },
    });
    const dualLocalEffective: LogicalWorkspace = {
      ...base,
      localWorkspace,
      cloudWorkspace,
      effectiveOwner: "local",
    };
    const dualCloudEffective: LogicalWorkspace = {
      ...dualLocalEffective,
      id: "dual-cloud-effective",
      effectiveOwner: "cloud",
      preferredMaterializationId: `cloud:${cloudWorkspace.id}`,
      lifecycle: "cloud_active",
    };

    const groups = buildGroups({
      logicalWorkspaces: [dualLocalEffective, dualCloudEffective],
    });

    expect(groups[0]?.items.find((item) => item.id === "dual-local-effective")?.detailIndicators.map(
      (indicator) => indicator.kind,
    )).toEqual(["automation", "materialization"]);
    expect(groups[0]?.items.find((item) => item.id === "dual-cloud-effective")?.detailIndicators.map(
      (indicator) => indicator.kind,
    )).toEqual(["materialization"]);
  });

  it("uses cloud activity for dual rows when cloud is the effective materialization", () => {
    const localWorkspace = makeWorkspace({
      id: "dual-local-materialization",
      repoName: "repo-a",
      sourceRoot: "/tmp/repo-a",
      kind: "worktree",
      branch: "feature/local",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "dual-cloud-materialization",
      repoName: "repo-a",
      branch: "feature/cloud",
    });
    const base = makeLocalLogicalWorkspace({
      id: "dual-cloud-effective",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      kind: "worktree",
      branch: "feature/local",
    });
    const dualCloudEffective: LogicalWorkspace = {
      ...base,
      localWorkspace,
      cloudWorkspace,
      effectiveOwner: "cloud",
      preferredMaterializationId: cloudWorkspaceSyntheticId(cloudWorkspace.id),
      lifecycle: "cloud_active",
    };

    const groups = buildGroups({
      logicalWorkspaces: [dualCloudEffective],
      workspaceActivities: {
        [localWorkspace.id]: "idle",
        [cloudWorkspaceSyntheticId(cloudWorkspace.id)]: "iterating",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("iterating");
  });

  it("shows cloud workspace errors in the left status channel", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeCloudLogicalWorkspace({
          id: "cloud-error",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ].map((workspace) => ({
        ...workspace,
        cloudWorkspace: workspace.cloudWorkspace
          ? { ...workspace.cloudWorkspace, status: "error", workspaceStatus: "error" }
          : workspace.cloudWorkspace,
      })),
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("error");
  });

  it("uses local activity for dual rows when local is the effective materialization", () => {
    const localWorkspace = makeWorkspace({
      id: "dual-local-materialization",
      repoName: "repo-a",
      sourceRoot: "/tmp/repo-a",
      kind: "worktree",
      branch: "feature/local",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "dual-cloud-materialization",
      repoName: "repo-a",
      branch: "feature/cloud",
    });
    const base = makeLocalLogicalWorkspace({
      id: "dual-local-effective",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      kind: "worktree",
      branch: "feature/local",
    });
    const dualLocalEffective: LogicalWorkspace = {
      ...base,
      localWorkspace,
      cloudWorkspace,
      effectiveOwner: "local",
      preferredMaterializationId: localWorkspace.id,
    };

    const groups = buildGroups({
      logicalWorkspaces: [dualLocalEffective],
      workspaceActivities: {
        [localWorkspace.id]: "waiting_input",
        [cloudWorkspaceSyntheticId(cloudWorkspace.id)]: "iterating",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("waiting_input");
  });

  it("uses a running workspace summary when mounted local activity is idle", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "running-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("running"),
        }),
      ],
      workspaceActivities: {
        "running-local-materialization": "idle",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("iterating");
  });

  it("uses running counts from mixed workspace summaries when mounted local activity is idle", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "mixed-running-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("awaiting_interaction", {
            runningCount: 1,
          }),
        }),
      ],
      workspaceActivities: {
        "mixed-running-local-materialization": "idle",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("iterating");
  });

  it("keeps mounted waiting input when the local workspace summary is running", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "input-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("running"),
        }),
      ],
      workspaceActivities: {
        "input-local-materialization": "waiting_input",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("waiting_input");
  });

  it("keeps mounted waiting plan when the local workspace summary is awaiting interaction", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "plan-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("awaiting_interaction"),
        }),
      ],
      workspaceActivities: {
        "plan-local-materialization": "waiting_plan",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("waiting_plan");
  });

  it("does not re-show an acknowledged local error from a coarse errored summary", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "acknowledged-error-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("errored"),
        }),
      ],
      workspaceActivities: {
        "acknowledged-error-local-materialization": "idle",
      },
    });

    expect(groups[0]?.items[0]?.statusIndicator).toBeNull();
  });

  it("uses a running local workspace summary when no mounted activity exists", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "summary-running-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("running"),
        }),
      ],
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("iterating");
  });

  it("uses an errored local workspace summary when no mounted activity exists", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "summary-error-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          executionSummary: workspaceExecutionSummary("errored"),
        }),
      ],
    });

    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("error");
  });

  it("shows needs review for completed materialized work that is newer than the logical workspace view", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "review-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      workspaceLastInteracted: {
        "review-local-materialization": "2026-04-13T10:10:00.000Z",
      },
      lastViewedAt: {
        "review-local": "2026-04-13T10:00:00.000Z",
      },
    });

    expect(groups[0]?.items[0]?.needsReview).toBe(true);
    expect(groups[0]?.items[0]?.lastInteracted).toBe("2026-04-13T10:10:00.000Z");
    expect(groups[0]?.items[0]?.statusIndicator).toMatchObject({
      kind: "needs_review",
      tooltip: "Needs review",
    });
  });

  it("keeps the needs-review marker for the selected workspace after work completes", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "review-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      selectedLogicalWorkspaceId: "review-local",
      workspaceLastInteracted: {
        "review-local-materialization": "2026-04-13T10:10:00.000Z",
      },
      lastViewedAt: {
        "review-local": "2026-04-13T10:00:00.000Z",
      },
    });

    expect(groups[0]?.items[0]?.active).toBe(true);
    expect(groups[0]?.items[0]?.needsReview).toBe(true);
    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("needs_review");
  });

  it("uses materialization view timestamps to avoid stale needs-review markers", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "review-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      workspaceLastInteracted: {
        "review-local-materialization": "2026-04-13T10:10:00.000Z",
      },
      lastViewedAt: {
        "review-local": "2026-04-13T10:00:00.000Z",
        "review-local-materialization": "2026-04-13T10:12:00.000Z",
      },
    });

    expect(groups[0]?.items[0]?.needsReview).toBe(false);
    expect(groups[0]?.items[0]?.statusIndicator).toBeNull();
  });

  it("prioritizes queued prompts over needs review when no active status exists", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "queued-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      pendingPromptCounts: { "queued-local": 1 },
      workspaceLastInteracted: { "queued-local": "2026-04-13T10:10:00.000Z" },
      lastViewedAt: { "queued-local": "2026-04-13T10:00:00.000Z" },
    });

    expect(groups[0]?.items[0]?.needsReview).toBe(true);
    expect(groups[0]?.items[0]?.statusIndicator?.kind).toBe("queued_prompt");
  });
});
