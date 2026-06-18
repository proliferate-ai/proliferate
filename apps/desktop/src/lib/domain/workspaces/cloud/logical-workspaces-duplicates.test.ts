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
  makeRepoRoot,
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
  it("gives every member of a multi-local bucket a distinct slot id and keeps cloud/mobility separate", () => {
    const repoRoot = makeRepoRoot();
    const olderLocal = makeWorkspace({
      id: "local-older",
      kind: "worktree",
      branch: "main",
      path: "/tmp/proliferate/worktrees/local-older",
      updatedAt: "2026-04-13T10:00:00.000Z",
    });
    const newerLocal = makeWorkspace({
      id: "local-newer",
      kind: "worktree",
      branch: "main",
      path: "/tmp/proliferate/worktrees/local-newer",
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
    const newerSlotId = buildLocalSlotLogicalWorkspaceId(newerLocal.id);
    const olderSlotId = buildLocalSlotLogicalWorkspaceId(olderLocal.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [newerLocal, olderLocal],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [mobilityWorkspace],
      currentSelectionId: null,
    });

    // Every member of a multi-local bucket gets its own distinct `local-slot:` id
    // (no member aliases the shared base id), so a new local workspace never
    // inherits another's logical identity during the pending window (#11).
    const canonical = logicalWorkspaces.find((workspace) => workspace.id === canonicalId);
    const newerSlot = logicalWorkspaces.find((workspace) => workspace.id === newerSlotId);
    const olderSlot = logicalWorkspaces.find((workspace) => workspace.id === olderSlotId);

    expect(logicalWorkspaces).toHaveLength(3);
    expect(newerSlot?.localWorkspace?.id).toBe(newerLocal.id);
    expect(newerSlot?.cloudWorkspace).toBeNull();
    expect(newerSlot?.mobilityWorkspace).toBeNull();
    expect(olderSlot?.localWorkspace?.id).toBe(olderLocal.id);
    expect(olderSlot?.cloudWorkspace).toBeNull();
    expect(olderSlot?.mobilityWorkspace).toBeNull();
    // Cloud + mobility records for the same folder+branch collapse into their own
    // canonical entry with no aliased local workspace.
    expect(canonical?.localWorkspace).toBeNull();
    expect(canonical?.cloudWorkspace?.id).toBe(cloudWorkspace.id);
    expect(canonical?.mobilityWorkspace?.id).toBe(mobilityWorkspace.id);
  });

  it("keeps distinct local workspaces that each have their own chats", () => {
    // Same folder+branch, but each record has its own sessions: they are
    // separate "project/feature threads" and must stay as distinct entries.
    const checkoutPath = "/tmp/proliferate";
    const firstLocal = {
      ...makeWorkspace({
        id: "local-first",
        branch: "main",
        updatedAt: "2026-06-02T09:10:00.000Z",
        executionSummary: makeExecutionSummary({
          totalSessionCount: 2,
          liveSessionCount: 0,
          updatedAt: "2026-06-02T09:15:00.000Z",
        }),
      }),
      path: checkoutPath,
    };
    const secondLocal = {
      ...makeWorkspace({
        id: "local-second",
        branch: "main",
        updatedAt: "2026-06-02T09:50:00.000Z",
        executionSummary: makeExecutionSummary({
          phase: "running",
          totalSessionCount: 1,
          liveSessionCount: 1,
          updatedAt: "2026-06-02T09:50:00.000Z",
        }),
      }),
      path: checkoutPath,
    };

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [secondLocal, firstLocal],
      repoRoots: [],
      cloudWorkspaces: [],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(2);
    const firstEntry = findLogicalWorkspace(logicalWorkspaces, firstLocal.id);
    const secondEntry = findLogicalWorkspace(logicalWorkspaces, secondLocal.id);
    expect(firstEntry?.localWorkspace?.id).toBe(firstLocal.id);
    expect(secondEntry?.localWorkspace?.id).toBe(secondLocal.id);
    expect(firstEntry?.id).not.toBe(secondEntry?.id);
  });

  it("folds a zero-session duplicate onto the local workspace that has chats", () => {
    // A genuinely-empty (setup-only / stale) duplicate of the same folder+branch
    // is hidden behind the used record rather than shown as a junk row, but stays
    // selectable via alias lookup.
    const checkoutPath = "/tmp/proliferate";
    const usedLocal = {
      ...makeWorkspace({
        id: "local-used",
        branch: "main",
        updatedAt: "2026-06-02T09:10:00.000Z",
        executionSummary: makeExecutionSummary({
          totalSessionCount: 3,
          liveSessionCount: 0,
          updatedAt: "2026-06-02T09:15:00.000Z",
        }),
      }),
      path: checkoutPath,
    };
    const emptyLocal = {
      ...makeWorkspace({
        id: "local-empty",
        branch: "main",
        updatedAt: "2026-06-02T09:50:00.000Z",
      }),
      path: checkoutPath,
    };

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [emptyLocal, usedLocal],
      repoRoots: [],
      cloudWorkspaces: [],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.localWorkspace?.id).toBe(usedLocal.id);
    expect(logicalWorkspaceRelatedIds(logicalWorkspaces[0]!)).toContain(emptyLocal.id);
    expect(findLogicalWorkspace(logicalWorkspaces, emptyLocal.id)?.id)
      .toBe(logicalWorkspaces[0]?.id);
    expect(findLogicalWorkspace(
      logicalWorkspaces,
      buildLocalSlotLogicalWorkspaceId(emptyLocal.id),
    )?.id).toBe(logicalWorkspaces[0]?.id);
  });

  it("keeps a just-created (selected, zero-session) duplicate visible next to a used sibling", () => {
    // Regression: clicking "New local workspace" on an already-used folder makes
    // a 0-session row that is immediately selected. It must show as its own entry
    // (not fold into the used sibling) so selection resolves to the new workspace.
    const checkoutPath = "/tmp/proliferate";
    const usedLocal = {
      ...makeWorkspace({
        id: "local-used",
        branch: "main",
        updatedAt: "2026-06-02T09:10:00.000Z",
        executionSummary: makeExecutionSummary({
          totalSessionCount: 3,
          liveSessionCount: 0,
          updatedAt: "2026-06-02T09:15:00.000Z",
        }),
      }),
      path: checkoutPath,
    };
    const justCreated = {
      ...makeWorkspace({
        id: "local-just-created",
        branch: "main",
        updatedAt: "2026-06-02T09:50:00.000Z",
      }),
      path: checkoutPath,
    };

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [usedLocal, justCreated],
      repoRoots: [],
      cloudWorkspaces: [],
      currentSelectionId: justCreated.id,
    });

    expect(logicalWorkspaces).toHaveLength(2);
    const createdEntry = findLogicalWorkspace(logicalWorkspaces, justCreated.id);
    const usedEntry = findLogicalWorkspace(logicalWorkspaces, usedLocal.id);
    expect(createdEntry?.localWorkspace?.id).toBe(justCreated.id);
    expect(usedEntry?.localWorkspace?.id).toBe(usedLocal.id);
    expect(createdEntry?.id).not.toBe(usedEntry?.id);
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
      repoRoots: [makeRepoRoot()],
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
