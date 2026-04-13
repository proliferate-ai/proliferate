import { describe, expect, it } from "vitest";
import { pickPrimaryMobilityBlocker } from "@/lib/domain/workspaces/mobility-blockers";

describe("pickPrimaryMobilityBlocker", () => {
  it("prioritizes active session blockers over less urgent source blockers", () => {
    const blocker = pickPrimaryMobilityBlocker({
      sourcePreflight: {
        canMove: false,
        blockers: [
          { code: "workspace_dirty", message: "Dirty workspace" },
          { code: "session_running", message: "Active session still running" },
        ],
        warnings: [],
        sessions: [],
      } as never,
      cloudPreflight: null,
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
    });

    expect(blocker?.code).toBe("session_running");
    expect(blocker?.body).toBe("One active session can't move yet.");
  });

  it("maps cloud branch mismatch blockers to product copy", () => {
    const blocker = pickPrimaryMobilityBlocker({
      sourcePreflight: null,
      cloudPreflight: {
        canStart: false,
        blockers: ["requested branch does not match logical workspace branch"],
        excludedPaths: [],
        workspace: {} as never,
      },
      direction: "cloud_to_local",
      branchName: "feature/workspace-mobility",
    });

    expect(blocker?.code).toBe("branch_mismatch");
    expect(blocker?.helper).toContain("feature/workspace-mobility");
  });

  it("maps GitHub branch-not-found blockers to branch_not_published", () => {
    const blocker = pickPrimaryMobilityBlocker({
      sourcePreflight: null,
      cloudPreflight: {
        canStart: false,
        blockers: ["The branch 'feature/workspace-mobility' was not found on GitHub."],
        excludedPaths: [],
        workspace: {} as never,
      },
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
    });

    expect(blocker?.code).toBe("branch_not_published");
    expect(blocker?.actionLabel).toBe("Publish branch");
  });

  it("normalizes head-mismatch blockers without collapsing them into cloud repo access", () => {
    const blocker = pickPrimaryMobilityBlocker({
      sourcePreflight: null,
      cloudPreflight: {
        canStart: false,
        blockers: ["The branch 'feature/workspace-mobility' on GitHub is not at the requested commit."],
        excludedPaths: [],
        workspace: {} as never,
      },
      direction: "local_to_cloud",
      branchName: "feature/workspace-mobility",
    });

    expect(blocker?.code).toBe("cloud_head_mismatch");
  });

  it("falls back to unknown copy for unstructured cloud errors", () => {
    const blocker = pickPrimaryMobilityBlocker({
      sourcePreflight: null,
      cloudPreflight: {
        canStart: false,
        blockers: ["unexpected upstream failure"],
        excludedPaths: [],
        workspace: {} as never,
      },
      direction: "local_to_cloud",
    });

    expect(blocker?.code).toBe("unknown");
    expect(blocker?.body).toBe("unexpected upstream failure");
  });

  it("only maps specific GitHub validation failures to cloud_repo_access", () => {
    const blocker = pickPrimaryMobilityBlocker({
      sourcePreflight: null,
      cloudPreflight: {
        canStart: false,
        blockers: ["Reconnect GitHub and grant repository access before moving this workspace to cloud."],
        excludedPaths: [],
        workspace: {} as never,
      },
      direction: "local_to_cloud",
    });

    expect(blocker?.code).toBe("cloud_repo_access");
  });
});
