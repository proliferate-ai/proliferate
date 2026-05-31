import { describe, expect, it } from "vitest";
import {
  getMobilityOverlayTitle,
  mobilityActionableCopy,
  mobilityBlockerCopy,
  mobilityBranchSyncLoadingCopy,
  mobilityLocationLabel,
  mobilityReconnectCopy,
  mobilityStatusCopy,
} from "@/lib/domain/workspaces/mobility/presentation";

describe("workspace mobility presentation", () => {
  it("maps workspace locations to labels and primary actions", () => {
    expect(mobilityLocationLabel("local_workspace")).toBe("Local workspace");
    expect(mobilityLocationLabel("local_worktree")).toBe("Local worktree");
    expect(mobilityLocationLabel("cloud_workspace")).toBe("Cloud workspace");

    expect(mobilityActionableCopy("local_workspace")).toEqual({
      headline: "Move to cloud",
      body: "Move this local workspace to a cloud runtime.",
      actionLabel: "Move to cloud",
      direction: "local_to_cloud",
    });
    expect(mobilityActionableCopy("local_worktree")).toEqual({
      headline: "Move to cloud",
      body: "Move this local worktree to a cloud runtime.",
      actionLabel: "Move to cloud",
      direction: "local_to_cloud",
    });
    expect(mobilityActionableCopy("cloud_workspace")).toEqual({
      headline: "Bring back local",
      body: "Move this workspace from cloud back to your local machine.",
      actionLabel: "Bring back local",
      direction: "cloud_to_local",
    });
  });

  it("maps mobility phases and directions to status copy and overlay titles", () => {
    expect(mobilityStatusCopy("provisioning", "local_to_cloud")).toEqual({
      title: "Preparing cloud workspace",
      description: "Starting this branch in the cloud.",
    });
    expect(mobilityStatusCopy("provisioning", "cloud_to_local")).toEqual({
      title: "Preparing local workspace",
      description: "Preparing this branch on your machine.",
    });
    expect(mobilityStatusCopy("transferring", "local_to_cloud")).toEqual({
      title: "Syncing workspace",
      description: "Moving workspace state to the new runtime.",
    });
    expect(mobilityStatusCopy("success", "local_to_cloud")).toEqual({
      title: "Now in cloud",
      description: "This workspace has moved to the cloud.",
    });
    expect(mobilityStatusCopy("success", "cloud_to_local")).toEqual({
      title: "Now local",
      description: "This workspace has moved back to your local machine.",
    });
    expect(mobilityStatusCopy("failed", "local_to_cloud")).toEqual({
      title: "Move did not finish",
      description: "The workspace stayed where it was.",
    });

    expect(getMobilityOverlayTitle("local_to_cloud", "finalizing")).toBe("Moving to cloud");
    expect(getMobilityOverlayTitle("cloud_to_local", "cleanup_pending")).toBe("Bringing back local");
    expect(getMobilityOverlayTitle("local_to_cloud", "cleanup_failed")).toBe("Cleanup needs retry");
  });

  it("maps reconnection and branch-sync states to copy", () => {
    expect(mobilityReconnectCopy("local_to_cloud")).toBe("Reconnect any MCP tools you need in cloud.");
    expect(mobilityReconnectCopy("cloud_to_local")).toBe(
      "Reconnect any MCP tools you need in this local environment.",
    );
    expect(mobilityBranchSyncLoadingCopy()).toEqual({
      headline: "Checking local branch sync",
      body: "Comparing your local branch with GitHub.",
    });
  });

  it("maps blocker codes to actionable copy", () => {
    expect(mobilityBlockerCopy({
      code: "branch_not_published",
      direction: "local_to_cloud",
      branchName: "feature/test-gap",
    })).toEqual({
      headline: "Publish branch before moving",
      body: "This branch isn't on GitHub yet.",
      helper: "Push `feature/test-gap` so the destination can check out the exact commit.",
      actionLabel: "Push and move",
    });

    expect(mobilityBlockerCopy({
      code: "workspace_dirty",
      direction: "local_to_cloud",
    })).toEqual({
      headline: "Prepare branch for move",
      body: "This workspace has uncommitted changes.",
      helper: "Commit and push these changes so the destination can check out the exact code.",
      actionLabel: "Prepare branch",
    });

    expect(mobilityBlockerCopy({
      code: "cloud_repo_access",
      direction: "cloud_to_local",
    })).toEqual({
      headline: "Can't bring this workspace back local yet",
      body: "GitHub access for this repo is not authorized.",
      helper: "You can be signed in while Proliferate is still missing access to this repository or organization.",
      actionLabel: "Manage GitHub access",
    });

    expect(mobilityBlockerCopy({
      code: "owner_mismatch",
      direction: "local_to_cloud",
    })).toEqual({
      headline: "Workspace is already in cloud",
      body: "This branch is already owned by the cloud workspace.",
      helper: "Open the cloud workspace or refresh the workspace list.",
      actionLabel: "Got it",
    });

    expect(mobilityBlockerCopy({
      code: "owner_mismatch",
      direction: "cloud_to_local",
    })).toEqual({
      headline: "Workspace is already local",
      body: "This branch is already owned by a local worktree.",
      helper: "Open the local worktree or refresh the workspace list.",
      actionLabel: "Got it",
    });

    expect(mobilityBlockerCopy({
      code: "unknown",
      direction: "local_to_cloud",
      rawMessage: "Runtime owner changed.",
    })).toEqual({
      headline: "Can't move this workspace to cloud yet",
      body: "Runtime owner changed.",
      helper: "Resolve the issue and try again.",
      actionLabel: "Got it",
    });
  });
});
