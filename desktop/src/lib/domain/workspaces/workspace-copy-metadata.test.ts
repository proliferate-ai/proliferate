import { describe, expect, it } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import { workspaceCopyMetadataForLogicalWorkspace } from "@/lib/domain/workspaces/workspace-copy-metadata";

function makeLogicalWorkspace(overrides: Partial<LogicalWorkspace> = {}): LogicalWorkspace {
  return {
    id: "remote:github:proliferate-ai:proliferate:main",
    repoKey: "github:proliferate-ai:proliferate",
    sourceRoot: "/Users/pablo/proliferate",
    repoRoot: {
      id: "repo-root",
      path: "/Users/pablo/proliferate",
    } as LogicalWorkspace["repoRoot"],
    provider: "github",
    owner: "proliferate-ai",
    repoName: "proliferate",
    branchKey: "main",
    displayName: "Proliferate",
    localWorkspace: null,
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: null,
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt: "2026-05-22T00:00:00Z",
    ...overrides,
  };
}

describe("workspaceCopyMetadataForLogicalWorkspace", () => {
  it("copies local workspace path and active current branch", () => {
    const metadata = workspaceCopyMetadataForLogicalWorkspace(makeLogicalWorkspace({
      branchKey: "main",
      localWorkspace: {
        id: "workspace-1",
        kind: "worktree",
        path: "/Users/pablo/.proliferate/worktrees/proliferate/feature",
        sourceRepoRootPath: "/Users/pablo/proliferate",
        originalBranch: "main",
        currentBranch: "pablo/feature",
      } as unknown as LogicalWorkspace["localWorkspace"],
    }));

    expect(metadata.workspaceLocation).toMatchObject({
      value: "/Users/pablo/.proliferate/worktrees/proliferate/feature",
      menuLabel: "Copy workspace path",
      toastLabel: "Workspace path",
    });
    expect(metadata.branchName).toBe("pablo/feature");
  });

  it("falls back to repository identity for cloud-only workspaces", () => {
    const metadata = workspaceCopyMetadataForLogicalWorkspace(makeLogicalWorkspace({
      effectiveOwner: "cloud",
      lifecycle: "cloud_active",
      cloudWorkspace: {
        id: "cloud-1",
        displayName: null,
        repo: {
          provider: "github",
          owner: "proliferate-ai",
          name: "proliferate",
          branch: "pablo/cloud",
          baseBranch: "main",
        },
        status: "ready",
        workspaceStatus: "ready",
        statusDetail: null,
        lastError: null,
        templateVersion: null,
        updatedAt: "2026-05-22T00:00:00Z",
        createdAt: "2026-05-22T00:00:00Z",
        postReadyPhase: "idle",
        postReadyFilesTotal: 0,
        postReadyFilesApplied: 0,
        postReadyStartedAt: null,
        postReadyCompletedAt: null,
        visibility: "private",
      },
    }));

    expect(metadata.workspaceLocation).toMatchObject({
      value: "proliferate-ai/proliferate",
      menuLabel: "Copy repository",
      toastLabel: "Repository",
    });
    expect(metadata.branchName).toBe("pablo/cloud");
  });

  it("uses mobility workspace repository metadata when direct cloud metadata is absent", () => {
    const metadata = workspaceCopyMetadataForLogicalWorkspace(makeLogicalWorkspace({
      owner: null,
      repoName: null,
      effectiveOwner: "cloud",
      lifecycle: "cloud_active",
      mobilityWorkspace: {
        id: "mobility-1",
        displayName: null,
        repo: {
          provider: "github",
          owner: "proliferate-ai",
          name: "runtime",
          branch: "pablo/runtime",
        },
        owner: "cloud",
        lifecycleState: "cloud_active",
        statusDetail: null,
        lastError: null,
        cloudWorkspaceId: "cloud-1",
        cloudLostAt: null,
        cloudLostReason: null,
        activeHandoff: null,
        updatedAt: "2026-05-22T00:00:00Z",
        createdAt: "2026-05-22T00:00:00Z",
      },
    }));

    expect(metadata.workspaceLocation?.value).toBe("proliferate-ai/runtime");
    expect(metadata.branchName).toBe("pablo/runtime");
  });
});
