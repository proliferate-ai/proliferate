import { describe, expect, it } from "vitest";
import type { WorkspaceExecutionSummary } from "@anyharness/sdk";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import {
  buildGroups,
  makeCloudLogicalWorkspace,
  makeCloudWorkspace,
  makeLocalLogicalWorkspace,
  makeWorkspace,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

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
    // needs_review is no longer a status-indicator kind — it renders as the
    // trailing unread dot driven by `needsReview` (§3.4).
    expect(groups[0]?.items[0]?.statusIndicator).toBeNull();
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
    expect(groups[0]?.items[0]?.statusIndicator).toBeNull();
  });

  it("suppresses needs-review for the selected workspace while the window is focused", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "review-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeLocalLogicalWorkspace({
          id: "other-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      selectedLogicalWorkspaceId: "review-local",
      suppressActiveNeedsReview: true,
      workspaceLastInteracted: {
        "review-local-materialization": "2026-04-13T10:10:00.000Z",
        "other-local-materialization": "2026-04-13T10:10:00.000Z",
      },
      lastViewedAt: {
        "review-local": "2026-04-13T10:00:00.000Z",
        "other-local": "2026-04-13T10:00:00.000Z",
      },
    });

    const selectedItem = groups[0]?.items.find((item) => item.id === "review-local");
    const otherItem = groups[0]?.items.find((item) => item.id === "other-local");
    expect(selectedItem?.active).toBe(true);
    expect(selectedItem?.needsReview).toBe(false);
    expect(selectedItem?.statusIndicator).toBeNull();
    expect(otherItem?.needsReview).toBe(true);
    expect(otherItem?.statusIndicator).toBeNull();
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
  it("outranks activity with the worktree-missing indicator when the checkout is gone", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "missing-local",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          availability: "workspace_directory_missing",
          executionSummary: workspaceExecutionSummary("errored"),
        }),
      ],
    });

    const indicator = groups[0]?.items[0]?.statusIndicator;
    expect(indicator?.kind).toBe("worktree_missing");
    expect(indicator?.tooltip).toBe("Worktree no longer exists");
  });
});
