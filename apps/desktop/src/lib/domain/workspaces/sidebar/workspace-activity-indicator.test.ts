import { describe, expect, it } from "vitest";
import {
  buildWorkspaceActivityIndicatorSnapshot,
} from "@/lib/domain/workspaces/sidebar/workspace-activity-indicator";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
} from "@/lib/domain/workspaces/sidebar/sidebar-model";
import {
  makeLocalLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

function buildSnapshot(
  overrides: Partial<Parameters<typeof buildWorkspaceActivityIndicatorSnapshot>[0]> = {},
) {
  return buildWorkspaceActivityIndicatorSnapshot({
    logicalWorkspaces: [],
    workspaceActivities: {},
    archivedSet: new Set(),
    hiddenRepoRootIds: new Set(),
    workspaceTypes: DEFAULT_SIDEBAR_WORKSPACE_TYPES,
    lastViewedAt: {},
    workspaceLastInteracted: {},
    ...overrides,
  });
}

describe("workspace activity indicator", () => {
  it("is idle when all visible workspaces are viewed and idle", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "quiet-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [workspace],
      workspaceLastInteracted: {
        "quiet-workspace-materialization": "2026-04-13T10:00:00.000Z",
      },
      lastViewedAt: {
        "quiet-workspace": "2026-04-13T10:05:00.000Z",
      },
    })).toEqual({
      state: "idle",
      attentionCount: 0,
    });
  });

  it("reports attention for unread workspace activity", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "unread-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [workspace],
      workspaceLastInteracted: {
        "unread-workspace-materialization": "2026-04-13T10:10:00.000Z",
      },
      lastViewedAt: {
        "unread-workspace": "2026-04-13T10:00:00.000Z",
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("reports attention for waiting input and plan approval", () => {
    const inputWorkspace = makeLocalLogicalWorkspace({
      id: "input-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });
    const planWorkspace = makeLocalLogicalWorkspace({
      id: "plan-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [inputWorkspace, planWorkspace],
      workspaceActivities: {
        "input-workspace-materialization": "waiting_input",
        "plan-workspace-materialization": "waiting_plan",
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 2,
    });
  });

  it("reports attention for active iterating workspace activity", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "iterating-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [workspace],
      workspaceActivities: {
        "iterating-workspace-materialization": "iterating",
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("reports attention for active session activity on the workspace", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "session-active-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [workspace],
      sessionWorkspaceIds: {
        "session-1": "session-active-workspace-materialization",
      },
      sessionActivities: {
        "session-1": "waiting_input",
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("reports attention for unread session activity on the workspace", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "session-unread-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [workspace],
      sessionWorkspaceIds: {
        "session-1": "session-unread-workspace-materialization",
      },
      sessionLastInteracted: {
        "session-1": "2026-04-13T10:10:00.000Z",
      },
      sessionLastViewedAt: {
        "session-1": "2026-04-13T10:00:00.000Z",
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 1,
    });
  });

  it("reports attention for errors and queued prompts", () => {
    const errorWorkspace = makeLocalLogicalWorkspace({
      id: "error-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });
    const queuedWorkspace = makeLocalLogicalWorkspace({
      id: "queued-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [errorWorkspace, queuedWorkspace],
      workspaceActivities: {
        "error-workspace-materialization": "error",
      },
      pendingPromptCounts: {
        "queued-workspace": 1,
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 2,
    });
  });

  it("ignores archived workspaces", () => {
    const workspace = makeLocalLogicalWorkspace({
      id: "archived-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [workspace],
      workspaceActivities: {
        "archived-workspace-materialization": "error",
      },
      archivedSet: new Set(["archived-workspace"]),
    })).toMatchObject({
      state: "idle",
      attentionCount: 0,
    });
  });

  it("includes the active non-archived workspace even when its variant is filtered out", () => {
    const activeWorkspace = makeLocalLogicalWorkspace({
      id: "active-local-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });
    const filteredWorkspace = makeLocalLogicalWorkspace({
      id: "filtered-local-workspace",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });

    expect(buildSnapshot({
      logicalWorkspaces: [activeWorkspace, filteredWorkspace],
      selectedLogicalWorkspaceId: "active-local-workspace",
      workspaceTypes: ["cloud"],
      workspaceActivities: {
        "active-local-workspace-materialization": "waiting_input",
        "filtered-local-workspace-materialization": "error",
      },
    })).toMatchObject({
      state: "attention",
      attentionCount: 1,
    });
  });
});
