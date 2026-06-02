import type { Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  buildLogicalWorkspaces,
} from "@/lib/domain/workspaces/cloud/logical-workspaces";
import {
  findLogicalWorkspace,
  logicalWorkspaceRelatedIds,
} from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import {
  buildLocalSlotLogicalWorkspaceId,
  buildRemoteLogicalWorkspaceId,
} from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import {
  makeCloudWorkspace,
  makeWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

const DEFAULT_UPDATED_AT = "2026-04-13T10:00:00.000Z";
type WorkspaceExecutionSummary = NonNullable<Workspace["executionSummary"]>;

function makeExecutionSummary(args: {
  phase?: WorkspaceExecutionSummary["phase"];
  totalSessionCount?: number;
  liveSessionCount?: number;
  updatedAt?: string | null;
} = {}): WorkspaceExecutionSummary {
  const {
    phase = "idle",
    totalSessionCount = 0,
    liveSessionCount = 0,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;

  return {
    awaitingInteractionCount: phase === "awaiting_interaction" ? 1 : 0,
    erroredCount: phase === "errored" ? 1 : 0,
    idleCount: phase === "idle" ? totalSessionCount : 0,
    liveSessionCount,
    phase,
    runningCount: phase === "running" ? 1 : 0,
    totalSessionCount,
    updatedAt,
  };
}

function makeMobilityWorkspace(args: {
  id?: string;
  owner: "local" | "cloud" | "personal_cloud";
  branch?: string;
  cloudWorkspaceId?: string | null;
}) {
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
      provider: "github" as const,
      owner: "proliferate-ai",
      name: "proliferate",
      branch,
    },
    owner,
    lifecycleState: owner === "cloud" ? "cloud_active" as const : "local_active" as const,
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

describe("logical workspace duplicate local records", () => {
  it("splits duplicate local workspaces while merging cloud and mobility only with canonical", () => {
    const olderLocal = makeWorkspace({
      id: "local-older",
      branch: "main",
      updatedAt: "2026-04-13T10:00:00.000Z",
    });
    const newerLocal = makeWorkspace({
      id: "local-newer",
      branch: "main",
      updatedAt: "2026-04-13T11:00:00.000Z",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-main",
      branch: "main",
    });
    const mobilityWorkspace = makeMobilityWorkspace({
      id: "mobility-main",
      owner: "local",
      branch: "main",
      cloudWorkspaceId: cloudWorkspace.id,
    });
    const canonicalId = buildRemoteLogicalWorkspaceId(
      "github",
      "proliferate-ai",
      "proliferate",
      "main",
    );
    const slotId = buildLocalSlotLogicalWorkspaceId(newerLocal.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [newerLocal, olderLocal],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [mobilityWorkspace],
      currentSelectionId: null,
    });

    const canonical = logicalWorkspaces.find((workspace) => workspace.id === canonicalId);
    const slot = logicalWorkspaces.find((workspace) => workspace.id === slotId);

    expect(logicalWorkspaces).toHaveLength(2);
    expect(canonical?.localWorkspace?.id).toBe(olderLocal.id);
    expect(canonical?.cloudWorkspace?.id).toBe(cloudWorkspace.id);
    expect(canonical?.mobilityWorkspace?.id).toBe(mobilityWorkspace.id);
    expect(slot?.localWorkspace?.id).toBe(newerLocal.id);
    expect(slot?.cloudWorkspace).toBeNull();
    expect(slot?.mobilityWorkspace).toBeNull();
    expect(logicalWorkspaceRelatedIds(canonical!)).toContain(
      buildLocalSlotLogicalWorkspaceId(olderLocal.id),
    );
  });

  it("collapses exact duplicate local records and prefers transcript history over setup-only slots", () => {
    const checkoutPath = "/tmp/proliferate";
    const setupOnlyLocal = {
      ...makeWorkspace({
        id: "local-setup-only",
        branch: "main",
        updatedAt: "2026-06-02T09:50:00.000Z",
        executionSummary: makeExecutionSummary({
          phase: "running",
          totalSessionCount: 4,
          liveSessionCount: 4,
          updatedAt: "2026-06-02T09:50:00.000Z",
        }),
      }),
      path: checkoutPath,
      sourceRepoRootPath: checkoutPath,
    };
    const historicalLocal = {
      ...makeWorkspace({
        id: "local-with-transcript",
        branch: "main",
        updatedAt: "2026-06-02T09:10:00.000Z",
        executionSummary: makeExecutionSummary({
          totalSessionCount: 4,
          liveSessionCount: 0,
          updatedAt: "2026-06-02T09:15:00.000Z",
        }),
      }),
      path: checkoutPath,
      sourceRepoRootPath: checkoutPath,
    };

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [setupOnlyLocal, historicalLocal],
      repoRoots: [],
      cloudWorkspaces: [],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.localWorkspace?.id).toBe(historicalLocal.id);
    expect(logicalWorkspaceRelatedIds(logicalWorkspaces[0]!)).toContain(setupOnlyLocal.id);
    expect(logicalWorkspaceRelatedIds(logicalWorkspaces[0]!)).toContain(
      buildLocalSlotLogicalWorkspaceId(setupOnlyLocal.id),
    );
    expect(findLogicalWorkspace(logicalWorkspaces, setupOnlyLocal.id)?.id)
      .toBe(logicalWorkspaces[0]?.id);
    expect(findLogicalWorkspace(
      logicalWorkspaces,
      buildLocalSlotLogicalWorkspaceId(setupOnlyLocal.id),
    )?.id).toBe(logicalWorkspaces[0]?.id);

    const selectedDuplicateWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [setupOnlyLocal, historicalLocal],
      repoRoots: [],
      cloudWorkspaces: [],
      currentSelectionId: setupOnlyLocal.id,
    });

    expect(selectedDuplicateWorkspaces).toHaveLength(1);
    expect(selectedDuplicateWorkspaces[0]?.localWorkspace?.id).toBe(setupOnlyLocal.id);
    expect(selectedDuplicateWorkspaces[0]?.preferredMaterializationId).toBe(setupOnlyLocal.id);
    expect(logicalWorkspaceRelatedIds(selectedDuplicateWorkspaces[0]!)).toContain(
      historicalLocal.id,
    );
  });

  it("promotes a prior local-slot workspace to canonical and preserves alias lookup", () => {
    const olderLocal = makeWorkspace({
      id: "local-older",
      branch: "main",
      updatedAt: "2026-04-13T10:00:00.000Z",
    });
    const newerLocal = makeWorkspace({
      id: "local-newer",
      branch: "main",
      updatedAt: "2026-04-13T11:00:00.000Z",
    });
    const staleSlotId = buildLocalSlotLogicalWorkspaceId(newerLocal.id);

    const beforeDeletion = buildLogicalWorkspaces({
      localWorkspaces: [olderLocal, newerLocal],
      repoRoots: [],
      cloudWorkspaces: [],
      currentSelectionId: null,
    });
    expect(findLogicalWorkspace(beforeDeletion, staleSlotId)?.localWorkspace?.id)
      .toBe(newerLocal.id);

    const afterDeletion = buildLogicalWorkspaces({
      localWorkspaces: [newerLocal],
      repoRoots: [],
      cloudWorkspaces: [makeCloudWorkspace({ id: "cloud-main", branch: "main" })],
      cloudMobilityWorkspaces: [makeMobilityWorkspace({
        id: "mobility-main",
        owner: "local",
        branch: "main",
        cloudWorkspaceId: "cloud-main",
      })],
      currentSelectionId: null,
    });
    const promoted = findLogicalWorkspace(afterDeletion, staleSlotId);

    expect(promoted?.id).toBe("remote:github:proliferate-ai:proliferate:main");
    expect(promoted?.localWorkspace?.id).toBe(newerLocal.id);
    expect(promoted?.cloudWorkspace?.id).toBe("cloud-main");
    expect(promoted?.mobilityWorkspace?.id).toBe("mobility-main");
    expect(afterDeletion.some((workspace) => workspace.id === staleSlotId)).toBe(false);
  });
});
