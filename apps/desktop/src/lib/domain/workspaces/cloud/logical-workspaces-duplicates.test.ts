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

describe("logical workspace duplicate local records", () => {
  it("splits duplicate local workspaces while merging cloud only with canonical", () => {
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
    const canonicalId = buildRemoteLogicalWorkspaceId(
      "github",
      "proliferate-ai",
      "proliferate",
      "main",
    );
    const slotId = buildLocalSlotLogicalWorkspaceId(newerLocal.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [newerLocal, olderLocal],
      repoRoots: [repoRoot],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: null,
    });

    const canonical = logicalWorkspaces.find((workspace) => workspace.id === canonicalId);
    const slot = logicalWorkspaces.find((workspace) => workspace.id === slotId);

    expect(logicalWorkspaces).toHaveLength(2);
    expect(canonical?.localWorkspace?.id).toBe(olderLocal.id);
    expect(canonical?.cloudWorkspace?.id).toBe(cloudWorkspace.id);
    expect(slot?.localWorkspace?.id).toBe(newerLocal.id);
    expect(slot?.cloudWorkspace).toBeNull();
    expect(logicalWorkspaceRelatedIds(canonical!)).toContain(
      buildLocalSlotLogicalWorkspaceId(olderLocal.id),
    );
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
      currentSelectionId: null,
    });
    const promoted = findLogicalWorkspace(afterDeletion, staleSlotId);

    expect(promoted?.id).toBe("remote:github:proliferate-ai:proliferate:main");
    expect(promoted?.localWorkspace?.id).toBe(newerLocal.id);
    expect(promoted?.cloudWorkspace?.id).toBe("cloud-main");
    expect(afterDeletion.some((workspace) => workspace.id === staleSlotId)).toBe(false);
  });
});
