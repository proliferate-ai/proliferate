import { describe, expect, it } from "vitest";
import { targetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import type { CloudMobilityWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import {
  buildLogicalWorkspaces,
} from "@/lib/domain/workspaces/cloud/logical-workspaces";
import {
  expandLogicalWorkspaceRelatedIdSet,
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  buildLocalSlotLogicalWorkspaceId,
  buildRemoteLogicalWorkspaceId,
  parseLogicalWorkspaceId,
  replaceLogicalWorkspaceBranch,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  logicalWorkspaceCloudRuntimeMaterializationId,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-materialization";
import {
  buildGroups,
  makeCloudWorkspace,
  makeRepoRoot,
  makeWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

function makeMobilityWorkspace(args: {
  id?: string;
  owner: "local" | "cloud" | "personal_cloud";
  branch?: string;
  cloudWorkspaceId?: string | null;
}): CloudMobilityWorkspaceSummary {
  const {
    id = "mobility-1",
    owner,
    branch = "main",
    cloudWorkspaceId = "cloud-1",
  } = args;

  return {
    id,
    displayName: branch,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch,
    },
    owner,
    lifecycleState: owner === "cloud" ? "cloud_active" : "local_active",
    statusDetail: null,
    lastError: null,
    cloudWorkspaceId,
    cloudLostAt: null,
    cloudLostReason: null,
    activeHandoff: null,
    updatedAt: "2026-04-13T00:00:00Z",
    createdAt: "2026-04-13T00:00:00Z",
  };
}

describe("logical workspaces", () => {
  it("omits non-selected cloud workspaces that failed before readiness", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [
        makeCloudWorkspace({
          id: "cloud-failed",
          branch: "failed-before-ready",
          status: "error",
          readyAt: null,
        }),
      ],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(0);
  });

  it("retains the selected cloud workspace that failed before readiness", () => {
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-failed",
      branch: "failed-before-ready",
      status: "error",
      readyAt: null,
    });

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: cloudWorkspaceSyntheticId(cloudWorkspace.id),
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.cloudWorkspace?.id).toBe("cloud-failed");
  });

  it("keeps errored cloud workspaces that previously reached readiness", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [
        makeCloudWorkspace({
          id: "cloud-ready-error",
          branch: "ready-before-error",
          status: "error",
          readyAt: "2026-04-13T10:00:00.000Z",
        }),
      ],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.cloudWorkspace?.id).toBe("cloud-ready-error");
  });

  it("keeps mobility-only placeholders without throwing", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [],
      cloudMobilityWorkspaces: [
        {
          id: "mobility-1",
          displayName: "seal",
          repo: {
            provider: "github",
            owner: "proliferate-ai",
            name: "landing",
            branch: "seal",
          },
          owner: "local",
          lifecycleState: "moving_to_cloud",
          statusDetail: "Preparing cloud workspace",
          lastError: null,
          cloudWorkspaceId: null,
          cloudLostAt: null,
          cloudLostReason: null,
          activeHandoff: null,
          updatedAt: "2026-04-13T00:00:00Z",
          createdAt: "2026-04-13T00:00:00Z",
        },
      ],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBeNull();
    expect(resolveLogicalWorkspaceMaterializationId(logicalWorkspaces[0]!)).toBeNull();
  });

  it("groups mobility-only placeholders by repository identity instead of branch identity", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          id: "mobility-1",
          owner: "cloud",
          branch: "twilight",
          cloudWorkspaceId: "cloud-1",
        }),
        makeMobilityWorkspace({
          id: "mobility-2",
          owner: "cloud",
          branch: "ember",
          cloudWorkspaceId: "cloud-2",
        }),
      ],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(2);
    expect(logicalWorkspaces.map((workspace) => workspace.repoKey)).toEqual([
      "github:proliferate-ai:proliferate",
      "github:proliferate-ai:proliferate",
    ]);
    expect(logicalWorkspaces.map((workspace) => workspace.repoName)).toEqual([
      "proliferate",
      "proliferate",
    ]);
    expect(logicalWorkspaces.map((workspace) => workspace.branchKey).sort()).toEqual([
      "ember",
      "twilight",
    ]);
  });

  it("keeps detached worktree materializations distinct by original branch", () => {
    const repoRoot = makeRepoRoot({ id: "proliferate-root" });
    const gecko = makeWorkspace({
      id: "gecko-workspace",
      kind: "worktree",
      currentBranch: "HEAD",
      originalBranch: "gecko",
      updatedAt: "2026-04-13T10:00:00Z",
    });
    const polecat = makeWorkspace({
      id: "polecat-workspace",
      kind: "worktree",
      currentBranch: "HEAD",
      originalBranch: "polecat",
      updatedAt: "2026-04-13T11:00:00Z",
    });

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [gecko, polecat],
      repoRoots: [repoRoot],
      cloudWorkspaces: [],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces.map((workspace) => workspace.branchKey).sort()).toEqual([
      "gecko",
      "polecat",
    ]);
    expect(logicalWorkspaces.map((workspace) => workspace.localWorkspace?.id).sort()).toEqual([
      "gecko-workspace",
      "polecat-workspace",
    ]);
  });

  it("does not let a local checkout current branch hide a worktree branch", () => {
    const repoRoot = makeRepoRoot({ id: "proliferate-root" });
    const localCheckout = makeWorkspace({
      id: "local-ant",
      kind: "local",
      currentBranch: "polecat",
      originalBranch: "ant",
      updatedAt: "2026-04-13T12:00:00Z",
    });
    const subagentWorktree = makeWorkspace({
      id: "subagent-polecat",
      kind: "worktree",
      currentBranch: "HEAD",
      originalBranch: "polecat",
      updatedAt: "2026-04-13T11:00:00Z",
    });

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localCheckout, subagentWorktree],
      repoRoots: [repoRoot],
      cloudWorkspaces: [],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces.map((workspace) => workspace.branchKey).sort()).toEqual([
      "ant",
      "polecat",
    ]);
    expect(logicalWorkspaces.map((workspace) => workspace.localWorkspace?.id).sort()).toEqual([
      "local-ant",
      "subagent-polecat",
    ]);
  });

  it("merges a matching local repo root with mobility-only placeholders in one sidebar group", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [makeRepoRoot({ sourceRoot: "/tmp/proliferate" })],
      cloudWorkspaces: [],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          id: "mobility-1",
          owner: "cloud",
          branch: "twilight",
          cloudWorkspaceId: "cloud-1",
        }),
        makeMobilityWorkspace({
          id: "mobility-2",
          owner: "cloud",
          branch: "ember",
          cloudWorkspaceId: "cloud-2",
        }),
      ],
      currentSelectionId: null,
    });

    const groups = buildGroups({
      repoRoots: [makeRepoRoot({ sourceRoot: "/tmp/proliferate" })],
      logicalWorkspaces,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("/tmp/proliferate");
    expect(groups[0]?.name).toBe("proliferate");
    expect(groups[0]?.items.map((item) => item.id)).toHaveLength(2);
  });

  it("canonicalizes repo-root-backed local workspaces before merging cloud materializations", () => {
    const repoRoot = makeRepoRoot({
      id: "proliferate-root",
      sourceRoot: "/tmp/proliferate",
    });
    const localWorkspace = {
      ...makeWorkspace({
        id: "local-porcupine",
        branch: "porcupine",
        sourceRoot: "/tmp/proliferate",
      }),
    };
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-porcupine",
      branch: "porcupine",
    });

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.id).toBe(
      buildRemoteLogicalWorkspaceId("github", "proliferate-ai", "proliferate", "porcupine"),
    );
    expect(logicalWorkspaces[0]?.repoKey).toBe("github:proliferate-ai:proliferate");
    expect(logicalWorkspaces[0]?.localWorkspace?.id).toBe("local-porcupine");
    expect(logicalWorkspaces[0]?.cloudWorkspace?.id).toBe("cloud-porcupine");

    const groups = buildGroups({
      repoRoots: [repoRoot],
      logicalWorkspaces,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "remote:github:proliferate-ai:proliferate:porcupine",
    ]);
  });

  it("keeps different branches separate while sharing the repo-root-backed group", () => {
    const repoRoot = makeRepoRoot({
      id: "proliferate-root",
      sourceRoot: "/tmp/proliferate",
    });
    const localWorkspace = {
      ...makeWorkspace({
        id: "local-porcupine",
        branch: "porcupine",
        sourceRoot: "/tmp/proliferate",
      }),
    };
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-raven",
      branch: "raven",
    });

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces.map((workspace) => workspace.branchKey).sort()).toEqual([
      "porcupine",
      "raven",
    ]);

    const groups = buildGroups({
      repoRoots: [repoRoot],
      logicalWorkspaces,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id).sort()).toEqual([
      "remote:github:proliferate-ai:proliferate:porcupine",
      "remote:github:proliferate-ai:proliferate:raven",
    ]);
  });

  it("honors a local mobility owner over a stale selected cloud materialization", () => {
    const repoRoot = makeRepoRoot();
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });
    const staleCloudSelectionId = cloudWorkspaceSyntheticId(cloudWorkspace.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          owner: "local",
          branch: "gannet",
          cloudWorkspaceId: cloudWorkspace.id,
        }),
      ],
      currentSelectionId: staleCloudSelectionId,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBe(localWorkspace.id);
    expect(logicalWorkspaces[0]?.effectiveOwner).toBe("local");
    expect(resolveLogicalWorkspaceMaterializationId(
      logicalWorkspaces[0]!,
      staleCloudSelectionId,
    )).toBe(localWorkspace.id);
  });

  it("honors a cloud mobility owner over a stale selected local materialization", () => {
    const repoRoot = makeRepoRoot();
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });
    const cloudSelectionId = cloudWorkspaceSyntheticId(cloudWorkspace.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          owner: "cloud",
          branch: "gannet",
          cloudWorkspaceId: cloudWorkspace.id,
        }),
      ],
      currentSelectionId: localWorkspace.id,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBe(cloudSelectionId);
    expect(logicalWorkspaces[0]?.effectiveOwner).toBe("cloud");
    expect(resolveLogicalWorkspaceMaterializationId(
      logicalWorkspaces[0]!,
      localWorkspace.id,
    )).toBe(cloudSelectionId);
  });

  it("prefers the mobility-linked cloud workspace over an archived duplicate branch", () => {
    const archivedCloudWorkspace = makeCloudWorkspace({
      id: "cloud-archived",
      branch: "main",
      status: "archived",
      productLifecycle: "archived",
      updatedAt: "2026-04-13T11:00:00Z",
    });
    const activeCloudWorkspace = makeCloudWorkspace({
      id: "cloud-active",
      branch: "main",
      updatedAt: "2026-04-13T10:00:00Z",
    });
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [activeCloudWorkspace, archivedCloudWorkspace],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          owner: "cloud",
          branch: "main",
          cloudWorkspaceId: activeCloudWorkspace.id,
        }),
      ],
      currentSelectionId: cloudWorkspaceSyntheticId(archivedCloudWorkspace.id),
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.cloudWorkspace?.id).toBe(activeCloudWorkspace.id);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBe(
      cloudWorkspaceSyntheticId(activeCloudWorkspace.id),
    );
  });

  it("groups logical, local, and cloud materialization ids for attention timestamps", () => {
    const repoRoot = makeRepoRoot();
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });
    const logicalWorkspace = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: localWorkspace.id,
    })[0]!;

    expect(logicalWorkspaceRelatedIds(logicalWorkspace)).toEqual([
      "remote:github:proliferate-ai:proliferate:gannet",
      "local-1",
      "local-slot:local-1",
      "cloud:cloud-1",
    ]);
    expect(latestLogicalWorkspaceTimestamp({
      "remote:github:proliferate-ai:proliferate:gannet": "2026-04-13T10:00:00.000Z",
      "cloud:cloud-1": "2026-04-13T10:05:00.000Z",
      "local-1": "2026-04-13T10:10:00.000Z",
    }, logicalWorkspace)).toBe("2026-04-13T10:10:00.000Z");
  });

  it("expands archived local-slot aliases to the current logical workspace ids", () => {
    const repoRoot = makeRepoRoot();
    const localWorkspace = makeWorkspace({
      id: "local-newer",
      branch: "main",
      updatedAt: "2026-04-13T11:00:00.000Z",
    });
    const staleSlotId = buildLocalSlotLogicalWorkspaceId(localWorkspace.id);
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [makeCloudWorkspace({ id: "cloud-main", branch: "main" })],
      currentSelectionId: null,
    });

    const expanded = expandLogicalWorkspaceRelatedIdSet(logicalWorkspaces, [staleSlotId]);

    expect(expanded.has(staleSlotId)).toBe(true);
    expect(expanded.has(localWorkspace.id)).toBe(true);
    expect(expanded.has("remote:github:proliferate-ai:proliferate:main")).toBe(true);
    expect(expanded.has("cloud:cloud-main")).toBe(true);
  });

  it("uses direct target materialization for cloud workspaces backed by SSH targets", () => {
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "automation/ssh-run",
      directTargetContext: {
        targetId: "target-1",
        targetKind: "ssh",
        anyharnessWorkspaceId: "workspace-1",
      },
    });
    const targetMaterializationId = targetWorkspaceSyntheticId("target-1", "workspace-1");

    const logicalWorkspace = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: null,
    })[0]!;

    expect(logicalWorkspace.preferredMaterializationId).toBe(targetMaterializationId);
    expect(resolveLogicalWorkspaceMaterializationId(logicalWorkspace)).toBe(targetMaterializationId);
    expect(
      resolveLogicalWorkspaceMaterializationId(
        logicalWorkspace,
        cloudWorkspaceSyntheticId(cloudWorkspace.id),
      ),
    ).toBe(targetMaterializationId);
    expect(logicalWorkspaceRelatedIds(logicalWorkspace)).toEqual([
      "remote:github:proliferate-ai:proliferate:automation%2Fssh-run",
      "cloud:cloud-1",
      targetMaterializationId,
    ]);
  });

  it("keeps cloud-synced local workspaces on the local materialization", () => {
    const repoRoot = makeRepoRoot();
    const localWorkspace = makeWorkspace({
      id: "local-main",
      branch: "main",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-main",
      branch: "main",
      sandboxType: "local",
    });
    const cloudAliasId = cloudWorkspaceSyntheticId(cloudWorkspace.id);

    const logicalWorkspace = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          owner: "personal_cloud",
          branch: "main",
          cloudWorkspaceId: cloudWorkspace.id,
        }),
      ],
      currentSelectionId: cloudAliasId,
    })[0]!;

    expect(logicalWorkspace.preferredMaterializationId).toBe(localWorkspace.id);
    expect(logicalWorkspace.effectiveOwner).toBe("local");
    expect(resolveLogicalWorkspaceMaterializationId(logicalWorkspace, cloudAliasId))
      .toBe(localWorkspace.id);
    expect(logicalWorkspaceCloudRuntimeMaterializationId(logicalWorkspace)).toBeNull();
    expect(logicalWorkspaceRelatedIds(logicalWorkspace)).toContain(cloudAliasId);
  });

  it("does not materialize a cloud-only local sync record as a cloud runtime", () => {
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-main",
      branch: "main",
      sandboxType: "local",
    });
    const cloudAliasId = cloudWorkspaceSyntheticId(cloudWorkspace.id);

    const logicalWorkspace = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: cloudAliasId,
    })[0]!;

    expect(logicalWorkspace.preferredMaterializationId).toBeNull();
    expect(logicalWorkspace.effectiveOwner).toBe("local");
    expect(resolveLogicalWorkspaceMaterializationId(logicalWorkspace, cloudAliasId)).toBeNull();
    expect(logicalWorkspaceCloudRuntimeMaterializationId(logicalWorkspace)).toBeNull();
    expect(logicalWorkspaceRelatedIds(logicalWorkspace)).toContain(cloudAliasId);
  });

  it("replaces the branch segment while preserving logical workspace identity", () => {
    expect(
      replaceLogicalWorkspaceBranch(
        "remote:github:proliferate-ai:proliferate:parrot",
        "feature/hi",
      ),
    ).toBe("remote:github:proliferate-ai:proliferate:feature%2Fhi");

    expect(
      replaceLogicalWorkspaceBranch(
        "repo-root:repo-root-1:parrot",
        "hi",
      ),
    ).toBe("repo-root:repo-root-1:hi");

    expect(
      replaceLogicalWorkspaceBranch(
        "path:%2FUsers%2Fpablo%2Fproliferate:parrot",
        "hi",
      ),
    ).toBe("path:%2FUsers%2Fpablo%2Fproliferate:hi");
  });

  it("parses local-slot ids strictly and leaves branch replacement unchanged", () => {
    const localSlotId = buildLocalSlotLogicalWorkspaceId("workspace id");

    expect(localSlotId).toBe("local-slot:workspace%20id");
    expect(parseLogicalWorkspaceId(localSlotId)).toEqual({
      kind: "local-slot",
      segments: ["workspace id"],
    });
    expect(replaceLogicalWorkspaceBranch(localSlotId, "feature/new")).toBe(localSlotId);
    expect(parseLogicalWorkspaceId("local-slot:")).toBeNull();
    expect(parseLogicalWorkspaceId("local-slot:workspace:extra")).toBeNull();
    expect(parseLogicalWorkspaceId("local-slot:%2Ftmp%2Fworkspace")).toBeNull();
    expect(parseLogicalWorkspaceId("local-slot:..")).toBeNull();
  });
});
