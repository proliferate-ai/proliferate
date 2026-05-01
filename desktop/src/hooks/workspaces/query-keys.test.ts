import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsKey,
  workspaceCollectionsScopeKey,
} from "./query-keys";

function makeCollections(overrides: Partial<WorkspaceCollections> = {}): WorkspaceCollections {
  return {
    localWorkspaces: [],
    retiredLocalWorkspaces: [],
    repoRoots: [],
    cloudWorkspaces: [],
    workspaces: [],
    allWorkspaces: [],
    cleanupAttentionWorkspaces: [],
    ...overrides,
  };
}

describe("getWorkspaceCollectionsFromCache", () => {
  it("returns workspace collections stored under a scoped key variant", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:7007";
    const collections = makeCollections();

    queryClient.setQueryData(workspaceCollectionsKey(runtimeUrl, true), collections);

    expect(getWorkspaceCollectionsFromCache(queryClient, runtimeUrl)).toEqual(collections);
  });

  it("prefers the most recently updated scoped query", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:7007";
    const staleCollections = makeCollections({
      localWorkspaces: [{ id: "stale" }],
    } as unknown as Partial<WorkspaceCollections>);
    const freshCollections = makeCollections({
      localWorkspaces: [{ id: "fresh" }],
    } as unknown as Partial<WorkspaceCollections>);

    queryClient.setQueryData(
      workspaceCollectionsKey(runtimeUrl, false),
      staleCollections,
      { updatedAt: 100 },
    );
    queryClient.setQueryData(
      workspaceCollectionsKey(runtimeUrl, true),
      freshCollections,
      { updatedAt: 200 },
    );

    expect(getWorkspaceCollectionsFromCache(queryClient, runtimeUrl)).toEqual(freshCollections);
  });

  it("ignores non-collection data sharing the workspace cache prefix", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:7007";
    const collections = makeCollections({
      localWorkspaces: [{ id: "workspace-1" }],
    } as unknown as Partial<WorkspaceCollections>);

    queryClient.setQueryData(
      workspaceCollectionsKey(runtimeUrl, true),
      collections,
      { updatedAt: 100 },
    );
    queryClient.setQueryData(
      [...workspaceCollectionsScopeKey(runtimeUrl), "workspace-1", "finish-suggestion"],
      { workspaceId: "workspace-1", canRetire: true },
      { updatedAt: 200 },
    );

    expect(getWorkspaceCollectionsFromCache(queryClient, runtimeUrl)).toEqual(collections);
  });
});
