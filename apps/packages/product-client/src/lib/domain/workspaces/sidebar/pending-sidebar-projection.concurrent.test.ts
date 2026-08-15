import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  buildGroups,
  makeLocalLogicalWorkspace,
  makeRepoRoot,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

// Concurrency half of the pending sidebar projection suite: one row per live
// attempt, ordering against real workspaces, failure indicators, and the
// duplicate suppression once an unattended attempt's workspace lands. Split
// from `pending-sidebar-projection.test.ts` to stay under the repo file-size
// gate; the single-attempt projection cases live there.

describe("concurrent pending sidebar rows", () => {
  function worktreeEntry(args: {
    attemptId: string;
    displayName: string;
    repoRootId?: string;
    repoLabel?: string;
    workspaceId?: string | null;
    stage?: PendingWorkspaceEntry["stage"];
    errorMessage?: string | null;
  }): PendingWorkspaceEntry {
    return {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: args.attemptId,
        selectedWorkspaceId: null,
        source: "worktree-created",
        displayName: args.displayName,
        repoLabel: args.repoLabel ?? "landing",
        baseBranchName: "main",
        request: {
          kind: "worktree" as const,
          input: {
            repoRootId: args.repoRootId ?? "landing-root",
            workspaceName: args.displayName,
            branchName: args.displayName,
            baseBranch: "main",
            targetPath: `/tmp/landing/${args.displayName}`,
          },
        },
      }),
      workspaceId: args.workspaceId ?? null,
      stage: args.stage ?? "submitting",
      errorMessage: args.errorMessage ?? null,
    };
  }

  const landingRepoRoot = makeRepoRoot({
    id: "landing-root",
    repoName: "landing",
    sourceRoot: "/tmp/landing",
  });

  it("renders one row per live attempt in the same repo group, in launch order", () => {
    const first = worktreeEntry({ attemptId: "attempt-1", displayName: "gulch" });
    const second = worktreeEntry({ attemptId: "attempt-2", displayName: "arroyo" });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [first, second],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      buildPendingWorkspaceUiKey(first),
      buildPendingWorkspaceUiKey(second),
    ]);
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual([
      buildPendingWorkspaceUiKey(first),
      buildPendingWorkspaceUiKey(second),
    ]);
  });

  it("puts pending rows ahead of the group's real workspaces", () => {
    const pending = worktreeEntry({ attemptId: "attempt-1", displayName: "gulch" });

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-existing",
          workspaceId: "workspace-existing",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
          kind: "worktree",
          branch: "existing",
        }),
      ],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [pending],
    });

    expect(groups[0]?.items[0]?.id).toBe(buildPendingWorkspaceUiKey(pending));
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("renders concurrent attempts across two repo groups", () => {
    const landing = worktreeEntry({ attemptId: "attempt-1", displayName: "gulch" });
    const other = worktreeEntry({
      attemptId: "attempt-2",
      displayName: "mesa",
      repoRootId: "docs-root",
      repoLabel: "docs",
    });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [
        landingRepoRoot,
        makeRepoRoot({ id: "docs-root", repoName: "docs", sourceRoot: "/tmp/docs" }),
      ],
      pendingWorkspaceEntries: [landing, other],
    });

    expect(groups).toHaveLength(2);
    expect(new Map(groups.map((group) => [
      group.name,
      group.items.map((item) => item.id),
    ]))).toEqual(new Map([
      ["landing", [buildPendingWorkspaceUiKey(landing)]],
      ["docs", [buildPendingWorkspaceUiKey(other)]],
    ]));
  });

  it("carries an error indicator on a failed row and keeps it clickable", () => {
    const failed = worktreeEntry({
      attemptId: "attempt-1",
      displayName: "gulch",
      stage: "failed",
      errorMessage: "Branch already exists",
    });
    const running = worktreeEntry({ attemptId: "attempt-2", displayName: "arroyo" });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [failed, running],
    });

    expect(groups[0]?.items[0]?.statusIndicator).toEqual({
      kind: "error",
      tooltip: "Branch already exists",
      action: {
        kind: "open_workspace",
        workspaceId: buildPendingWorkspaceUiKey(failed),
      },
    });
    expect(groups[0]?.items[1]?.statusIndicator).toBeNull();
  });

  it("suppresses the duplicate row for an unattended attempt whose workspace landed", () => {
    // The correctness trap: this attempt is NOT selected, so suppression cannot
    // key off selection. Its real workspace is already in the collections cache
    // and sorts into the same group, and without a selection-independent rule
    // the user sees the pending row and the real row at once.
    const unattended = worktreeEntry({
      attemptId: "attempt-1",
      displayName: "gulch",
      workspaceId: "workspace-gulch",
    });

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-gulch",
          workspaceId: "workspace-gulch",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
          kind: "worktree",
          branch: "gulch",
        }),
      ],
      repoRoots: [landingRepoRoot],
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      pendingWorkspaceEntries: [unattended],
    });

    expect(groups[0]?.items.map((item) => item.id))
      .toEqual([buildPendingWorkspaceUiKey(unattended)]);
  });

  it("suppresses the duplicate row when the real workspace sorts into another group", () => {
    // A local launch projects into the source-root group while its created
    // workspace lands in the repo-root group, so a suppression scoped to the
    // pending row's own group would miss it entirely.
    const unattended = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "local-created",
        displayName: "landing",
        request: { kind: "local" as const, sourceRoot: "/tmp/elsewhere" },
      }),
      workspaceId: "workspace-landing",
    };

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-logical",
          workspaceId: "workspace-landing",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
        }),
      ],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [unattended],
    });

    const allItemIds = groups.flatMap((group) => group.items.map((item) => item.id));
    expect(allItemIds).toEqual([buildPendingWorkspaceUiKey(unattended)]);
  });
});
