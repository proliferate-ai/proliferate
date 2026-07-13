import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CommitRequest,
  GitDiffOptions,
  GitRevertPatchesRequest,
  ListBaseWorktreeDiffFilesOptions,
  ListBranchDiffFilesOptions,
  PushRequest,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessCacheScopeKey } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  type AnyHarnessQueryTimingOptions,
  useReportAnyHarnessCacheDecision,
} from "../lib/timing-options.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessGitBranchesKey,
  anyHarnessGitBaseWorktreeDiffFilesKey,
  anyHarnessGitBranchDiffFilesKey,
  anyHarnessGitDiffKey,
  anyHarnessGitDiffScopeKey,
  anyHarnessGitStatusKey,
  anyHarnessPullRequestKey,
} from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
}

type TimedWorkspaceQueryOptions = WorkspaceQueryOptions & AnyHarnessQueryTimingOptions;

type TimedGitDiffQueryOptions = {
  workspaceId?: string | null;
  path: string | null;
  scope?: GitDiffOptions["scope"];
  baseRef?: string | null;
  oldPath?: string | null;
  enabled?: boolean;
} & AnyHarnessQueryTimingOptions;

type TimedBranchDiffFilesQueryOptions =
  & WorkspaceQueryOptions
  & ListBranchDiffFilesOptions
  & AnyHarnessQueryTimingOptions;

type TimedBaseWorktreeDiffFilesQueryOptions =
  & WorkspaceQueryOptions
  & ListBaseWorktreeDiffFilesOptions
  & AnyHarnessQueryTimingOptions;

async function invalidateWorkspaceGit(
  queryClient: ReturnType<typeof useQueryClient>,
  cacheScopeKey: string,
  workspaceId: string | null | undefined,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: anyHarnessGitStatusKey(cacheScopeKey, workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessGitBranchesKey(cacheScopeKey, workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessGitDiffScopeKey(cacheScopeKey, workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessPullRequestKey(cacheScopeKey, workspaceId),
    }),
  ]);
}

export function useGitStatusQuery(options?: TimedWorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const enabled = (options?.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessGitStatusKey(cacheScopeKey, workspaceId);
  useReportAnyHarnessCacheDecision({
    category: "git.status",
    enabled,
    queryKey,
    onCacheDecision: options?.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.getStatus(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
  });
}

export function useGitDiffQuery(options: TimedGitDiffQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const enabled = (options.enabled ?? true) && !!workspaceId && !!options.path;
  const queryKey = anyHarnessGitDiffKey(
    cacheScopeKey,
    workspaceId,
    options.path,
    options.scope,
    options.baseRef,
    options.oldPath,
  );
  useReportAnyHarnessCacheDecision({
    category: "git.diff",
    enabled,
    queryKey,
    onCacheDecision: options.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.getDiff(resolved.connection.anyharnessWorkspaceId, options.path!, {
        scope: options.scope,
        baseRef: options.baseRef,
        oldPath: options.oldPath,
        request: requestOptionsWithSignal(options.requestOptions, signal),
      });
    },
  });
}

export function useGitBranchDiffFilesQuery(
  options?: TimedBranchDiffFilesQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const enabled = (options?.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessGitBranchDiffFilesKey(cacheScopeKey, workspaceId, options?.baseRef);
  useReportAnyHarnessCacheDecision({
    category: "git.branch_diff_files",
    enabled,
    queryKey,
    onCacheDecision: options?.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.listBranchDiffFiles(resolved.connection.anyharnessWorkspaceId, {
        baseRef: options?.baseRef,
        request: requestOptionsWithSignal(options?.requestOptions, signal),
      });
    },
  });
}

export function useGitBaseWorktreeDiffFilesQuery(
  options?: TimedBaseWorktreeDiffFilesQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const enabled = (options?.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessGitBaseWorktreeDiffFilesKey(cacheScopeKey, workspaceId, options?.baseRef);
  useReportAnyHarnessCacheDecision({
    category: "git.base_worktree_diff_files",
    enabled,
    queryKey,
    onCacheDecision: options?.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.listBaseWorktreeDiffFiles(resolved.connection.anyharnessWorkspaceId, {
        baseRef: options?.baseRef,
        request: requestOptionsWithSignal(options?.requestOptions, signal),
      });
    },
  });
}

export function useGitBranchesQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessGitBranchesKey(cacheScopeKey, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.listBranches(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function useStageGitPathsMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (paths: string[]) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.git.stagePaths(resolved.connection.anyharnessWorkspaceId, paths);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function useUnstageGitPathsMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (paths: string[]) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.git.unstagePaths(resolved.connection.anyharnessWorkspaceId, paths);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function useStagePatchMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (patch: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.git.stagePatch(resolved.connection.anyharnessWorkspaceId, patch);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function useUnstagePatchMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (patch: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.git.unstagePatch(resolved.connection.anyharnessWorkspaceId, patch);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function useRevertGitPatchesMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: GitRevertPatchesRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.revertPatches(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function useCommitGitMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: CommitRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.commit(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function usePushGitMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input?: PushRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.push(resolved.connection.anyharnessWorkspaceId, input ?? {});
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}

export function useRenameGitBranchMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (newName: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.renameBranch(resolved.connection.anyharnessWorkspaceId, newName);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, cacheScopeKey, workspaceId),
  });
}
