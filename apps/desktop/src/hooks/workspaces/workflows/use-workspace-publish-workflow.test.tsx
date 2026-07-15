// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitStatusSnapshot } from "@anyharness/sdk";
import type { PublishIntent } from "@/lib/domain/workspaces/creation/publish-workflow-model";
import { useWorkspacePublishWorkflow } from "./use-workspace-publish-workflow";

interface QueryMock<T> {
  data: T;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
}

interface MutationMock {
  isPending: boolean;
  mutateAsync: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  gitStatusQuery: null as QueryMock<GitStatusSnapshot | undefined> | null,
  currentPrQuery: null as QueryMock<{ pullRequest: null } | undefined> | null,
  stageMutation: null as MutationMock | null,
  commitMutation: null as MutationMock | null,
  pushMutation: null as MutationMock | null,
  createPullRequestMutation: null as MutationMock | null,
  refreshPrStatuses: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useGitStatusQuery: () => mocks.gitStatusQuery!,
  useCurrentPullRequestQuery: () => mocks.currentPrQuery!,
  useStageGitPathsMutation: () => mocks.stageMutation!,
  useCommitGitMutation: () => mocks.commitMutation!,
  usePushGitMutation: () => mocks.pushMutation!,
  useCreatePullRequestMutation: () => mocks.createPullRequestMutation!,
}));

vi.mock("@/hooks/workspaces/cache/use-pr-status-refresh", () => ({
  useRefreshPrStatuses: () => mocks.refreshPrStatuses,
}));

vi.mock("@/hooks/workspaces/derived/use-logical-workspaces", () => ({
  useLogicalWorkspaces: () => ({ logicalWorkspaces: [] }),
}));

vi.mock("@/stores/preferences/workspace-ui-store", () => ({
  recordWorkspaceGitStatusSnapshot: vi.fn(),
  useWorkspaceUiStore: {
    getState: () => ({ gitStatusSnapshotByWorkspace: {} }),
  },
}));

beforeEach(() => {
  mocks.gitStatusQuery = query(status());
  mocks.currentPrQuery = query({ pullRequest: null });
  mocks.stageMutation = mutation();
  mocks.commitMutation = mutation();
  mocks.pushMutation = mutation();
  mocks.createPullRequestMutation = mutation({ pullRequest: null });
  mocks.refreshPrStatuses.mockClear();
});

describe("useWorkspacePublishWorkflow", () => {
  it("preserves drafts across intent switches and resets them explicitly", () => {
    const { result, rerender } = renderWorkflow("commit");

    act(() => {
      result.current.setCommitDraft({ summary: "Keep this message", includeUnstaged: true });
      result.current.setPullRequestDraft({
        title: "Keep this title",
        body: "Keep this body",
        baseBranch: "develop",
        draft: true,
      });
    });

    rerender({ intent: "publish" });
    rerender({ intent: "pull_request" });
    expect(result.current.commitDraft.summary).toBe("Keep this message");
    expect(result.current.pullRequestDraft.title).toBe("Keep this title");

    act(() => result.current.resetDrafts());
    expect(result.current.commitDraft).toEqual({ summary: "", includeUnstaged: false });
    expect(result.current.pullRequestDraft).toEqual({
      title: "",
      body: "",
      baseBranch: "main",
      draft: false,
    });
  });

  it("stays submitting across every step of a multi-step publish", async () => {
    const commit = deferred<void>();
    const push = deferred<void>();
    mocks.commitMutation!.mutateAsync.mockImplementation(() => commit.promise);
    mocks.pushMutation!.mutateAsync.mockImplementation(() => push.promise);
    const { result } = renderWorkflow("publish");
    act(() => result.current.setCommitDraft({
      summary: "Publish safely",
      includeUnstaged: false,
    }));

    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.submit();
    });
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      commit.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.pushMutation!.mutateAsync).toHaveBeenCalledTimes(1));
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      push.resolve();
      expect(await submission).toBe(true);
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  it("refreshes state after a partial failure and lets the error be cleared", async () => {
    mocks.pushMutation!.mutateAsync.mockRejectedValueOnce(new Error("Push failed"));
    const { result } = renderWorkflow("publish");
    act(() => result.current.setCommitDraft({
      summary: "Commit before push",
      includeUnstaged: false,
    }));

    let didComplete = true;
    await act(async () => {
      didComplete = await result.current.submit();
    });
    expect(didComplete).toBe(false);
    expect(result.current.error).toBe("Push failed");
    expect(mocks.gitStatusQuery!.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.currentPrQuery!.refetch).toHaveBeenCalledTimes(1);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("keeps pull request submission loading until the existing PR lookup settles", () => {
    mocks.currentPrQuery = {
      ...mocks.currentPrQuery!,
      isLoading: true,
    };

    const { result } = renderWorkflow("pull_request");
    expect(result.current.isLoading).toBe(true);
  });
});

function renderWorkflow(intent: PublishIntent) {
  return renderHook(
    ({ intent: currentIntent }: { intent: PublishIntent }) => useWorkspacePublishWorkflow({
      workspaceId: "workspace-1",
      initialIntent: currentIntent,
      runtimeBlockedReason: null,
      repoDefaultBranch: "main",
      enabled: true,
    }),
    { initialProps: { intent } },
  );
}

function query<T>(data: T): QueryMock<T> {
  return {
    data,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data }),
  };
}

function mutation(result?: unknown): MutationMock {
  return {
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue(result),
  };
}

function changedFile(path: string): GitChangedFile {
  return {
    path,
    oldPath: undefined,
    status: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    includedState: "included",
  };
}

function status(): GitStatusSnapshot {
  return {
    workspaceId: "workspace-1",
    workspacePath: "/repo",
    repoRootPath: "/repo",
    currentBranch: "feature/demo",
    headOid: "abc",
    detached: false,
    upstreamBranch: "origin/feature/demo",
    suggestedBaseBranch: "main",
    ahead: 0,
    behind: 0,
    operation: "none",
    conflicted: false,
    clean: false,
    summary: {
      changedFiles: 1,
      additions: 1,
      deletions: 1,
      includedFiles: 1,
      conflictedFiles: 0,
    },
    actions: {
      canCommit: true,
      canPush: true,
      pushLabel: "Push",
      canCreatePullRequest: false,
      canCreateDraftPullRequest: false,
      canCreateBranchWorkspace: true,
      reasonIfBlocked: undefined,
    },
    files: [changedFile("src/app.ts")],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
