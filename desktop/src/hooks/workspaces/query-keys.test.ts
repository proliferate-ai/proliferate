import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsKey,
} from "./query-keys";

describe("getWorkspaceCollectionsFromCache", () => {
  it("returns workspace collections stored under a scoped key variant", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:7007";
    const collections = {
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [],
      workspaces: [],
    } satisfies WorkspaceCollections;

    queryClient.setQueryData(workspaceCollectionsKey(runtimeUrl, true), collections);

    expect(getWorkspaceCollectionsFromCache(queryClient, runtimeUrl)).toEqual(collections);
  });

  it("prefers the most recently updated scoped query", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:7007";
    const staleCollections = {
      localWorkspaces: [{ id: "stale" }],
      repoRoots: [],
      cloudWorkspaces: [],
      workspaces: [],
    } as unknown as WorkspaceCollections;
    const freshCollections = {
      localWorkspaces: [{ id: "fresh" }],
      repoRoots: [],
      cloudWorkspaces: [],
      workspaces: [],
    } as unknown as WorkspaceCollections;

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
});
