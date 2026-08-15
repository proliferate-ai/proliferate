import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk/types";
import {
  buildWorkspaceCollections,
} from "#product/lib/domain/workspaces/cloud/collections";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsKey,
} from "#product/hooks/workspaces/cache/query-keys";
import {
  upsertCloudWorkspaceForRuntime,
} from "#product/hooks/workspaces/cache/use-workspace-collections-mutation-cache";

function makeCloudWorkspace(overrides: Partial<CloudWorkspaceDetail> = {}): CloudWorkspaceDetail {
  return {
    id: "cloud-1",
    targetId: "target-1",
    displayName: "Feature branch",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "feature-branch",
      baseBranch: "main",
    },
    status: "ready",
    workspaceStatus: "ready",
    productLifecycle: "active",
    runtime: {
      environmentId: "runtime-1",
      status: "running",
      generation: 1,
    },
    executionTarget: {
      kind: "managed_cloud",
      targetId: "target-1",
      online: true,
    },
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: "2026-05-30T18:00:00.000Z",
    createdAt: "2026-05-30T18:00:00.000Z",
    readyAt: "2026-05-30T18:01:00.000Z",
    postReadyPhase: "complete",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
    sandboxType: "managed_personal",
    ...overrides,
  } as CloudWorkspaceDetail;
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "local-1",
    path: "/tmp/repo",
    kind: "local",
    displayName: "Local",
    createdAt: "2026-05-30T17:00:00.000Z",
    updatedAt: "2026-05-30T17:00:00.000Z",
    repoRootId: null,
    lifecycleState: "active",
    ...overrides,
  } as Workspace;
}

describe("upsertCloudWorkspaceForRuntime", () => {
  // Cloud culling (PRO-10, FR-2): collections built at the data-source seam
  // remove cloud rows, so upserting a cloud workspace never surfaces it.
  // (Pre-cull this asserted the cache held ["cloud-1"].)
  it("keeps cloud workspaces culled when a cache is created", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:8502";
    const workspace = makeCloudWorkspace();

    upsertCloudWorkspaceForRuntime(queryClient, runtimeUrl, workspace);

    expect(
      getWorkspaceCollectionsFromCache(queryClient, runtimeUrl)?.cloudWorkspaces,
    ).toEqual([]);
  });

  it("preserves existing local workspace projections while cloud workspaces stay culled", () => {
    const queryClient = new QueryClient();
    const runtimeUrl = "http://127.0.0.1:8502";
    queryClient.setQueryData(
      workspaceCollectionsKey(runtimeUrl, true),
      buildWorkspaceCollections([makeWorkspace()], [], []),
    );

    upsertCloudWorkspaceForRuntime(queryClient, runtimeUrl, makeCloudWorkspace());

    const collections = getWorkspaceCollectionsFromCache(queryClient, runtimeUrl);
    expect(collections?.localWorkspaces.map((entry) => entry.id)).toEqual(["local-1"]);
    // Cloud culling (PRO-10, FR-2): cloud row never surfaces. (Pre-cull: ["cloud-1"].)
    expect(collections?.cloudWorkspaces).toEqual([]);
  });
});
