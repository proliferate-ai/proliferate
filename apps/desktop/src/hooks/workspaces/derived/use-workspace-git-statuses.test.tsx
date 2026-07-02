// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import type { PersistedWorkspaceGitStatusSnapshot } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import type { RepoPrStatusesState } from "@/hooks/workspaces/cache/use-repo-pr-statuses";
import { useWorkspaceGitStatuses } from "./use-workspace-git-statuses";

const mocks = vi.hoisted(() => ({
  logicalWorkspaces: [] as unknown[],
  collectionsResult: { isSuccess: true } as { isSuccess: boolean },
  inventoryRows: [] as unknown[],
  prState: {
    entriesByRepoRootId: {},
    availabilityByRepoRootId: {},
    fetchedAtByRepoRootId: {},
  } as unknown,
  requestedRepoRootIds: [] as string[],
}));

vi.mock("@/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({
    logicalWorkspaces: mocks.logicalWorkspaces,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => mocks.collectionsResult,
}));

vi.mock("@/hooks/workspaces/cache/use-repo-pr-statuses", () => ({
  useRepoPrStatuses: (repoRootIds: string[]) => {
    mocks.requestedRepoRootIds = repoRootIds;
    return mocks.prState;
  },
}));

vi.mock("@anyharness/sdk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anyharness/sdk-react")>();
  return {
    ...actual,
    useWorktreeInventoryQuery: () => ({ data: { rows: mocks.inventoryRows } }),
  };
});

const LOGICAL_ID = "repo-root:root-1:feature";
const FETCHED_AT = "2026-07-01T12:00:00.000Z";

function localLogicalWorkspace(): LogicalWorkspace {
  return {
    id: LOGICAL_ID,
    repoRoot: { id: "root-1" },
    localWorkspace: {
      id: "ws-1",
      path: "/var/w1",
      currentBranch: "feature",
      repoRootId: "root-1",
    },
    cloudWorkspace: null,
  } as unknown as LogicalWorkspace;
}

function cloudLogicalWorkspace(): LogicalWorkspace {
  return {
    id: "remote:github:o/r:main",
    repoRoot: null,
    localWorkspace: null,
    cloudWorkspace: { repo: { branch: "main" } },
  } as unknown as LogicalWorkspace;
}

function livePrState(fetchedAt: string): RepoPrStatusesState {
  return {
    entriesByRepoRootId: {
      "root-1": [{
        headBranch: "feature",
        pullRequest: {
          number: 805,
          title: "Feature",
          url: "https://github.com/o/r/pull/805",
          state: "open",
          draft: false,
          headBranch: "feature",
          baseBranch: "main",
        },
      }],
    },
    availabilityByRepoRootId: { "root-1": "ok" },
    fetchedAtByRepoRootId: { "root-1": fetchedAt },
  };
}

function snapshot(
  overrides?: Partial<PersistedWorkspaceGitStatusSnapshot>,
): PersistedWorkspaceGitStatusSnapshot {
  return {
    branch: "feature",
    prState: "merged",
    prNumber: 700,
    prUrl: "https://github.com/o/r/pull/700",
    checks: "none",
    reviewDecision: "none",
    capturedAt: "2026-07-01T10:00:00.000Z",
    lastPromptAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.logicalWorkspaces = [localLogicalWorkspace()];
  mocks.collectionsResult = { isSuccess: true };
  mocks.inventoryRows = [];
  mocks.prState = {
    entriesByRepoRootId: {},
    availabilityByRepoRootId: {},
    fetchedAtByRepoRootId: {},
  };
  useWorkspaceUiStore.setState({ gitStatusSnapshotByWorkspace: {} });
});

afterEach(() => {
  cleanup();
});

describe("useWorkspaceGitStatuses", () => {
  it("paints from the snapshot first, then flips to live PR data", () => {
    useWorkspaceUiStore.setState({
      gitStatusSnapshotByWorkspace: { [LOGICAL_ID]: snapshot() },
    });

    const { result, rerender } = renderHook(() => useWorkspaceGitStatuses());
    const snapshotStatus = result.current.statusesByLogicalId[LOGICAL_ID];
    expect(snapshotStatus?.source).toBe("snapshot");
    expect(snapshotStatus?.pr?.state).toBe("merged");
    expect(snapshotStatus?.pr?.number).toBe(700);

    mocks.prState = livePrState(FETCHED_AT);
    rerender();
    const liveStatus = result.current.statusesByLogicalId[LOGICAL_ID];
    expect(liveStatus?.source).toBe("live");
    expect(liveStatus?.pr?.state).toBe("open");
    expect(liveStatus?.pr?.number).toBe(805);
  });

  it("requests the distinct repo root ids derived from collections", () => {
    mocks.logicalWorkspaces = [localLogicalWorkspace(), cloudLogicalWorkspace()];
    renderHook(() => useWorkspaceGitStatuses());
    expect(mocks.requestedRepoRootIds).toEqual(["root-1"]);
  });

  it("matches PR entries by exact headBranch only", () => {
    mocks.prState = {
      entriesByRepoRootId: {
        "root-1": [{ headBranch: "feature-2", pullRequest: null }],
      },
      availabilityByRepoRootId: { "root-1": "ok" },
      fetchedAtByRepoRootId: { "root-1": FETCHED_AT },
    };
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    // Branch absent from entries → unknown, never authoritative none.
    expect(result.current.statusesByLogicalId[LOGICAL_ID]?.pr).toBeNull();
    expect(result.current.syncByLogicalId[LOGICAL_ID]?.branchQueried).toBe(false);
  });

  it("matches inventory rows by canonical path (/private normalization)", () => {
    mocks.inventoryRows = [{
      id: "row-1",
      path: "/private/var/w1",
      canonicalPath: "/private/var/w1",
      gitStatus: {
        state: "dirty",
        clean: false,
        conflicted: false,
        ahead: 3,
        behind: 1,
        changedFileCount: 2,
        untrackedFileCount: 0,
        upstreamBranch: "origin/feature",
      },
    }];
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    const status = result.current.statusesByLogicalId[LOGICAL_ID];
    expect(status?.dirty).toBe(true);
    expect(status?.ahead).toBe(3);
    expect(status?.behind).toBe(1);
    expect(status?.hasUpstream).toBe(true);
  });

  it("keys cloud-only workspaces by logical id with branch-only status", () => {
    mocks.logicalWorkspaces = [cloudLogicalWorkspace()];
    const { result } = renderHook(() => useWorkspaceGitStatuses());
    const status = result.current.statusesByLogicalId["remote:github:o/r:main"];
    expect(status?.branch).toBe("main");
    expect(status?.pr).toBeNull();
    expect(status?.dirty).toBeNull();
    expect(result.current.syncByLogicalId["remote:github:o/r:main"]?.repoRootId).toBeNull();
  });

  it("keeps Record identity stable across no-op polls (structural sharing)", () => {
    mocks.prState = livePrState(FETCHED_AT);
    const { result, rerender } = renderHook(() => useWorkspaceGitStatuses());
    const first = result.current.statusesByLogicalId;

    // A later poll with identical material data but a fresh fetchedAt.
    mocks.prState = livePrState("2026-07-01T12:02:00.000Z");
    rerender();

    expect(result.current.statusesByLogicalId).toBe(first);
    expect(result.current.statusesByLogicalId[LOGICAL_ID]).toBe(first[LOGICAL_ID]);
  });
});
