import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import {
  archivedWorkspaceMetaLine,
  filterAndSortArchivedWorkspaces,
  matchesArchivedWorkspaceSearch,
  resolveArchivedWorkspaceRepoName,
  sortArchivedWorkspaces,
} from "#product/lib/domain/workspaces/archived/archived-workspace-presentation";

function makeWorkspace(args: {
  id: string;
  displayName?: string | null;
  repoRootId?: string;
  path?: string;
  archivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): Workspace {
  return {
    id: args.id,
    displayName: args.displayName ?? null,
    repoRootId: args.repoRootId ?? "repo-root-1",
    path: args.path ?? `/tmp/${args.id}`,
    archivedAt: args.archivedAt ?? null,
    createdAt: args.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: args.updatedAt ?? "2026-01-01T00:00:00.000Z",
  } as unknown as Workspace;
}

function makeRepoRoot(args: { id: string; displayName?: string | null; path?: string }): RepoRoot {
  return {
    id: args.id,
    displayName: args.displayName ?? null,
    path: args.path ?? `/tmp/${args.id}`,
  } as unknown as RepoRoot;
}

const repoRoots: RepoRoot[] = [
  makeRepoRoot({ id: "repo-root-1", displayName: "proliferate", path: "/tmp/proliferate" }),
];

describe("archivedWorkspaceMetaLine", () => {
  it("reads 'Archived {date}' by default", () => {
    const workspace = makeWorkspace({ id: "w1", archivedAt: "2026-08-01T00:00:00.000Z" });
    expect(archivedWorkspaceMetaLine(workspace, repoRoots, "archived")).toMatch(
      /^proliferate · Archived /,
    );
  });

  it("reads 'Created {date}' when the sort is by created time", () => {
    const workspace = makeWorkspace({ id: "w1", createdAt: "2026-08-01T00:00:00.000Z" });
    expect(archivedWorkspaceMetaLine(workspace, repoRoots, "created")).toMatch(
      /^proliferate · Created /,
    );
  });

  it("falls back to updatedAt when archivedAt is absent", () => {
    const workspace = makeWorkspace({ id: "w1", archivedAt: null, updatedAt: "2026-08-01T00:00:00.000Z" });
    expect(archivedWorkspaceMetaLine(workspace, repoRoots, "archived")).toMatch(
      /^proliferate · Archived /,
    );
  });
});

describe("resolveArchivedWorkspaceRepoName", () => {
  it("prefers the repo root's display name", () => {
    const workspace = makeWorkspace({ id: "w1" });
    expect(resolveArchivedWorkspaceRepoName(workspace, repoRoots)).toBe("proliferate");
  });

  it("falls back to the workspace path basename when no repo root matches", () => {
    const workspace = makeWorkspace({ id: "w1", repoRootId: "missing", path: "/tmp/some-repo/worktree" });
    expect(resolveArchivedWorkspaceRepoName(workspace, repoRoots)).toBe("worktree");
  });
});

describe("sortArchivedWorkspaces", () => {
  const older = makeWorkspace({
    id: "older",
    displayName: "Zeta",
    archivedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const newer = makeWorkspace({
    id: "newer",
    displayName: "Alpha",
    archivedAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
  });

  it("orders newest-archived-first by default", () => {
    expect(sortArchivedWorkspaces([older, newer], "archived").map((w) => w.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("orders newest-created-first for 'created'", () => {
    expect(sortArchivedWorkspaces([older, newer], "created").map((w) => w.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("orders alphabetically (case-insensitive) for 'alpha'", () => {
    expect(sortArchivedWorkspaces([older, newer], "alpha").map((w) => w.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("matchesArchivedWorkspaceSearch", () => {
  const workspace = makeWorkspace({ id: "w1", displayName: "My Feature Branch" });

  it("matches on title, case-insensitively", () => {
    expect(matchesArchivedWorkspaceSearch(workspace, repoRoots, "feature")).toBe(true);
    expect(matchesArchivedWorkspaceSearch(workspace, repoRoots, "FEATURE")).toBe(true);
  });

  it("matches on repo name", () => {
    expect(matchesArchivedWorkspaceSearch(workspace, repoRoots, "proliferate")).toBe(true);
  });

  it("returns false for a query with no match", () => {
    expect(matchesArchivedWorkspaceSearch(workspace, repoRoots, "nothing-like-this")).toBe(false);
  });

  it("matches everything for a blank query", () => {
    expect(matchesArchivedWorkspaceSearch(workspace, repoRoots, "   ")).toBe(true);
  });
});

describe("filterAndSortArchivedWorkspaces", () => {
  it("filters then sorts", () => {
    const matching = makeWorkspace({ id: "matching", displayName: "Match Me", archivedAt: "2026-01-01T00:00:00.000Z" });
    const nonMatching = makeWorkspace({ id: "nonmatching", displayName: "Nope", archivedAt: "2026-06-01T00:00:00.000Z" });
    const result = filterAndSortArchivedWorkspaces([nonMatching, matching], repoRoots, "match", "archived");
    expect(result.map((w) => w.id)).toEqual(["matching"]);
  });
});
