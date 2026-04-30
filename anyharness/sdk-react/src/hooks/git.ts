import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CommitRequest,
  GitDiffOptions,
  ListBranchDiffFilesOptions,
  PushRequest,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  type AnyHarnessQueryTimingOptions,
  useReportAnyHarnessCacheDecision,
} from "../lib/timing-options.js";
import {
  anyHarnessGitBranchesKey,
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

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

async function invalidateWorkspaceGit(
  queryClient: ReturnType<typeof useQueryClient>,
  runtimeUrl: string,
  workspaceId: string | null | undefined,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: anyHarnessGitStatusKey(runtimeUrl, workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessGitBranchesKey(runtimeUrl, workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessGitDiffScopeKey(runtimeUrl, workspaceId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessPullRequestKey(runtimeUrl, workspaceId),
    }),
  ]);
}

export function useGitStatusQuery(options?: TimedWorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const enabled = (options?.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessGitStatusKey(runtimeUrl, workspaceId);
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
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.getStatus(
        resolved.connection.anyharnessWorkspaceId,
        options?.requestOptions,
      );
    },
  });
}

export function useGitDiffQuery(options: {
  workspaceId?: string | null;
  path: string | null;
  scope?: GitDiffOptions["scope"];
  baseRef?: string | null;
  oldPath?: string | null;
  enabled?: boolean;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessGitDiffKey(
      runtimeUrl,
      workspaceId,
      options.path,
      options.scope,
      options.baseRef,
      options.oldPath,
    ),
    enabled: (options.enabled ?? true) && !!workspaceId && !!options.path,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.getDiff(resolved.connection.anyharnessWorkspaceId, options.path!, {
        scope: options.scope,
        baseRef: options.baseRef,
        oldPath: options.oldPath,
      });
    },
  });
}

export function useGitBranchDiffFilesQuery(
  options?: WorkspaceQueryOptions & ListBranchDiffFilesOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessGitBranchDiffFilesKey(runtimeUrl, workspaceId, options?.baseRef),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.listBranchDiffFiles(resolved.connection.anyharnessWorkspaceId, {
        baseRef: options?.baseRef,
      });
    },
  });
}

export function useGitBranchesQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessGitBranchesKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.listBranches(resolved.connection.anyharnessWorkspaceId);
    },
  });
}

export function useStageGitPathsMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (paths: string[]) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.git.stagePaths(resolved.connection.anyharnessWorkspaceId, paths);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, runtimeUrl, workspaceId),
  });
}

export function useUnstageGitPathsMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (paths: string[]) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.git.unstagePaths(resolved.connection.anyharnessWorkspaceId, paths);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, runtimeUrl, workspaceId),
  });
}

export function useCommitGitMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: CommitRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.commit(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, runtimeUrl, workspaceId),
  });
}

export function usePushGitMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input?: PushRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.push(resolved.connection.anyharnessWorkspaceId, input ?? {});
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, runtimeUrl, workspaceId),
  });
}

export function useRenameGitBranchMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (newName: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.git.renameBranch(resolved.connection.anyharnessWorkspaceId, newName);
    },
    onSuccess: async () => invalidateWorkspaceGit(queryClient, runtimeUrl, workspaceId),
  });
}
