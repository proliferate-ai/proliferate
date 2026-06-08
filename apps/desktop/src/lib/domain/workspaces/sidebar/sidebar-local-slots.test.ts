import { describe, expect, it } from "vitest";
import { buildLocalSlotLogicalWorkspaceId } from "@/lib/domain/workspaces/cloud/logical-workspace-id";
import { resolveAutoShowMoreRepoKey } from "./sidebar-groups";
import {
  buildGroups,
  makeLocalLogicalWorkspace,
} from "./sidebar-test-fixtures";

describe("local-slot sidebar aliases", () => {
  it("uses local-slot aliases for active, archived, and queued sidebar state", () => {
    const logicalWorkspace = makeLocalLogicalWorkspace({
      id: "remote:github:proliferate-ai:repo-a:main",
      workspaceId: "workspace-local",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
    });
    const slotId = buildLocalSlotLogicalWorkspaceId("workspace-local");

    const groups = buildGroups({
      logicalWorkspaces: [logicalWorkspace],
      selectedLogicalWorkspaceId: slotId,
      showArchived: true,
      archivedIds: [slotId],
      pendingPromptCounts: {
        [slotId]: 2,
      },
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items[0]?.id).toBe("remote:github:proliferate-ai:repo-a:main");
    expect(groups[0]?.items[0]?.active).toBe(true);
    expect(groups[0]?.items[0]?.archived).toBe(true);
    expect(groups[0]?.items[0]?.statusIndicator).toEqual({
      kind: "queued_prompt",
      tooltip: "2 queued Home prompts",
    });
  });

  it("resolves a repo key when the selected local-slot alias is past the item cap", () => {
    const selectedSlotId = buildLocalSlotLogicalWorkspaceId("worktree-6-materialization");
    const groups = buildGroups({
      logicalWorkspaces: Array.from({ length: 7 }, (_, index) =>
        makeLocalLogicalWorkspace({
          id: `worktree-${index}`,
          workspaceId: `worktree-${index}-materialization`,
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: `feature/worktree-${index}`,
          updatedAt: `2026-04-13T10:0${index}:00.000Z`,
        })),
      selectedLogicalWorkspaceId: selectedSlotId,
    });

    const repoKey = resolveAutoShowMoreRepoKey({
      groups,
      selectedLogicalWorkspaceId: selectedSlotId,
      itemLimit: 6,
    });

    expect(repoKey).toBe("/tmp/repo-a");
  });

  it("suffixes duplicate local visible names within a repo group without marking overrides", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-older",
          workspaceId: "workspace-older",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          updatedAt: "2026-04-13T10:00:00.000Z",
        }),
        makeLocalLogicalWorkspace({
          id: "local-newer",
          workspaceId: "workspace-newer",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          updatedAt: "2026-04-13T11:00:00.000Z",
        }),
        makeLocalLogicalWorkspace({
          id: "local-override",
          workspaceId: "workspace-override",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          displayName: "repo-a",
          updatedAt: "2026-04-13T12:00:00.000Z",
        }),
        makeLocalLogicalWorkspace({
          id: "local-other-group",
          workspaceId: "workspace-other-group",
          repoKey: "/tmp/repo-b",
          repoName: "repo-a",
          updatedAt: "2026-04-13T13:00:00.000Z",
        }),
      ],
    });

    const firstGroupItems = groups.find((group) => group.sourceRoot === "/tmp/repo-a")?.items;
    const secondGroupItems = groups.find((group) => group.sourceRoot === "/tmp/repo-b")?.items;

    expect(firstGroupItems?.map((item) => ({
      id: item.id,
      name: item.name,
      defaultName: item.defaultName,
      hasDisplayNameOverride: item.hasDisplayNameOverride,
    }))).toEqual([
      {
        id: "local-older",
        name: "repo-a",
        defaultName: "repo-a",
        hasDisplayNameOverride: false,
      },
      {
        id: "local-newer",
        name: "repo-a #2",
        defaultName: "repo-a",
        hasDisplayNameOverride: false,
      },
      {
        id: "local-override",
        name: "repo-a #3",
        defaultName: "repo-a",
        hasDisplayNameOverride: true,
      },
    ]);
    expect(secondGroupItems?.[0]?.name).toBe("repo-b");
  });
});
