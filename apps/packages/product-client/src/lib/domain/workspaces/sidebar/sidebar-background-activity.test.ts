import { describe, expect, it } from "vitest";
import {
  buildGroups,
  makeLocalLogicalWorkspace,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

describe("sidebar background activity", () => {
  it("shows running activity while another workspace is selected", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "background-workspace",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
        }),
        makeLocalLogicalWorkspace({
          id: "selected-workspace",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
        }),
      ],
      selectedLogicalWorkspaceId: "selected-workspace",
      selectedWorkspaceId: "selected-workspace-materialization",
      workspaceActivities: {
        "background-workspace-materialization": "iterating",
      },
    });

    const background = groups[0]?.items.find((item) => item.id === "background-workspace");
    const selected = groups[0]?.items.find((item) => item.id === "selected-workspace");
    expect(background?.active).toBe(false);
    expect(background?.statusIndicator).toEqual({
      kind: "iterating",
      tooltip: "Iterating",
    });
    expect(selected?.active).toBe(true);
    expect(selected?.statusIndicator).toBeNull();
  });
});
