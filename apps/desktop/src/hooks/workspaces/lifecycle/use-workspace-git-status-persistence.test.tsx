// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceGitStatusesState } from "@/hooks/workspaces/derived/use-workspace-git-statuses";
import type {
  PersistedWorkspaceGitStatusSnapshot,
  WorkspaceGitStatus,
} from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useWorkspaceGitStatusPersistence } from "./use-workspace-git-status-persistence";

const mocks = vi.hoisted(() => ({
  gitStatuses: {
    statusesByLogicalId: {},
    syncByLogicalId: {},
    collectionsReady: true,
  } as unknown,
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-git-statuses", () => ({
  useWorkspaceGitStatuses: () => mocks.gitStatuses,
}));

const LOGICAL_ID = "repo-root:root-1:feature";
const EARLIER = "2026-07-01T10:00:00.000Z";
const FETCHED_AT = "2026-07-01T12:00:00.000Z";
const LATER = "2026-07-01T14:00:00.000Z";

function liveStatus(overrides?: Partial<WorkspaceGitStatus>): WorkspaceGitStatus {
  return {
    branch: "feature",
    dirty: false,
    conflicted: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    pr: {
      state: "open",
      number: 805,
      url: "https://github.com/o/r/pull/805",
      checks: "passing",
      reviewDecision: "none",
    },
    attention: "none",
    capturedAt: FETCHED_AT,
    source: "live",
    ...overrides,
  };
}

function statusesState(input: {
  status?: WorkspaceGitStatus;
  branchQueried?: boolean;
  availability?: "ok" | "gh_auth_required";
  fetchedAt?: string | null;
  prEntry?: unknown;
  collectionsReady?: boolean;
}): WorkspaceGitStatusesState {
  const status = input.status ?? liveStatus();
  return {
    statusesByLogicalId: { [LOGICAL_ID]: status },
    syncByLogicalId: {
      [LOGICAL_ID]: {
        repoRootId: "root-1",
        availability: input.availability ?? "ok",
        branchQueried: input.branchQueried ?? true,
        prEntry: (input.prEntry === undefined
          ? {
            headBranch: "feature",
            pullRequest: {
              number: 805,
              title: "Feature",
              url: "https://github.com/o/r/pull/805",
              state: "open",
              draft: false,
              headBranch: "feature",
              baseBranch: "main",
              checks: "passing",
              reviewDecision: "none",
            },
          }
          : input.prEntry) as WorkspaceGitStatusesState["syncByLogicalId"][string]["prEntry"],
        fetchedAt: input.fetchedAt === undefined ? FETCHED_AT : input.fetchedAt,
      },
    },
    collectionsReady: input.collectionsReady ?? true,
  };
}

function snapshot(
  overrides?: Partial<PersistedWorkspaceGitStatusSnapshot>,
): PersistedWorkspaceGitStatusSnapshot {
  return {
    branch: "feature",
    prState: "open",
    prNumber: 805,
    prUrl: "https://github.com/o/r/pull/805",
    checks: "passing",
    reviewDecision: "none",
    capturedAt: FETCHED_AT,
    lastPromptAt: null,
    ...overrides,
  };
}

function storedSnapshots(): Record<string, PersistedWorkspaceGitStatusSnapshot> {
  return useWorkspaceUiStore.getState().gitStatusSnapshotByWorkspace;
}

beforeEach(() => {
  useWorkspaceUiStore.setState({
    _hydrated: true,
    gitStatusSnapshotByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
});

describe("useWorkspaceGitStatusPersistence", () => {
  it("records a snapshot from live PR data once hydrated and loaded", () => {
    mocks.gitStatuses = statusesState({});
    renderHook(() => useWorkspaceGitStatusPersistence());

    expect(storedSnapshots()[LOGICAL_ID]).toEqual(snapshot());
  });

  it("does nothing before the workspace-ui store hydrates", () => {
    useWorkspaceUiStore.setState({
      _hydrated: false,
      gitStatusSnapshotByWorkspace: { "stale-id": snapshot() },
    });
    mocks.gitStatuses = statusesState({});
    renderHook(() => useWorkspaceGitStatusPersistence());

    expect(storedSnapshots()["stale-id"]).toBeDefined();
    expect(storedSnapshots()[LOGICAL_ID]).toBeUndefined();
  });

  it("never prunes before the collections load succeeds (no startup wipe)", () => {
    useWorkspaceUiStore.setState({
      gitStatusSnapshotByWorkspace: { "stale-id": snapshot() },
    });
    mocks.gitStatuses = statusesState({ collectionsReady: false });
    renderHook(() => useWorkspaceGitStatusPersistence());

    expect(storedSnapshots()["stale-id"]).toBeDefined();
  });

  it("prunes only ids absent from a successfully loaded collection", () => {
    useWorkspaceUiStore.setState({
      gitStatusSnapshotByWorkspace: {
        "stale-id": snapshot(),
        [LOGICAL_ID]: snapshot(),
      },
    });
    mocks.gitStatuses = statusesState({});
    renderHook(() => useWorkspaceGitStatusPersistence());

    expect(storedSnapshots()["stale-id"]).toBeUndefined();
    expect(storedSnapshots()[LOGICAL_ID]).toBeDefined();
  });

  it("preserves snapshot PR fields on gh outage (availability gate)", () => {
    useWorkspaceUiStore.setState({
      gitStatusSnapshotByWorkspace: {
        [LOGICAL_ID]: snapshot({ branch: "old-branch", capturedAt: EARLIER }),
      },
    });
    mocks.gitStatuses = statusesState({
      status: liveStatus({ branch: "old-branch", pr: null }),
      availability: "gh_auth_required",
      branchQueried: false,
      prEntry: null,
      fetchedAt: null,
    });
    renderHook(() => useWorkspaceGitStatusPersistence());

    const stored = storedSnapshots()[LOGICAL_ID];
    expect(stored?.prState).toBe("open");
    expect(stored?.prNumber).toBe(805);
    expect(stored?.branch).toBe("old-branch");
  });

  it("never records from data older than the stored snapshot (monotonic gate)", () => {
    const newer = snapshot({ prState: "merged", capturedAt: LATER });
    useWorkspaceUiStore.setState({
      gitStatusSnapshotByWorkspace: { [LOGICAL_ID]: newer },
    });
    mocks.gitStatuses = statusesState({
      prEntry: { headBranch: "feature", pullRequest: null },
      fetchedAt: EARLIER,
    });
    renderHook(() => useWorkspaceGitStatusPersistence());

    expect(storedSnapshots()[LOGICAL_ID]).toEqual(newer);
  });

  it("skips writes when nothing material changed (material-change gate)", () => {
    useWorkspaceUiStore.setState({
      gitStatusSnapshotByWorkspace: { [LOGICAL_ID]: snapshot({ capturedAt: EARLIER }) },
    });
    const before = storedSnapshots();
    mocks.gitStatuses = statusesState({});
    renderHook(() => useWorkspaceGitStatusPersistence());

    // Timestamp-only refresh: the record identity must be untouched.
    expect(storedSnapshots()).toBe(before);
  });
});
