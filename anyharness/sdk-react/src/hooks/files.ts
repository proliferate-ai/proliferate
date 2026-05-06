import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ReadWorkspaceFileResponse,
  RenameWorkspaceFileEntryRequest,
  WriteWorkspaceFileRequest,
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
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessGitDiffScopeKey,
  anyHarnessGitStatusKey,
  anyHarnessWorkspaceFileKey,
  anyHarnessWorkspaceFileSearchKey,
  anyHarnessWorkspaceFileSearchScopeKey,
  anyHarnessWorkspaceFilesScopeKey,
  anyHarnessWorkspaceFileStatKey,
  anyHarnessWorkspaceFileTreeKey,
} from "../lib/query-keys.js";

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useWorkspaceFilesQuery(options: {
  workspaceId?: string | null;
  path?: string;
  enabled?: boolean;
} & AnyHarnessQueryTimingOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const path = options.path ?? "";
  const enabled = (options.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, path);
  useReportAnyHarnessCacheDecision({
    category: "file.list",
    enabled,
    queryKey,
    onCacheDecision: options.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    notifyOnChangeProps: ["data", "error", "status"],
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.list(
        resolved.connection.anyharnessWorkspaceId,
        path,
        requestOptionsWithSignal(options.requestOptions, signal),
      );
    },
  });
}

export function useReadWorkspaceFileQuery(options: {
  workspaceId?: string | null;
  path: string | null;
  enabled?: boolean;
} & AnyHarnessQueryTimingOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const enabled = (options.enabled ?? true) && !!workspaceId && !!options.path;
  const queryKey = anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, options.path);
  useReportAnyHarnessCacheDecision({
    category: "file.read",
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
      return client.files.read(
        resolved.connection.anyharnessWorkspaceId,
        options.path!,
        requestOptionsWithSignal(options.requestOptions, signal),
      );
    },
  });
}

export function useSearchWorkspaceFilesQuery(options: {
  workspaceId?: string | null;
  query?: string;
  limit?: number;
  enabled?: boolean;
} & AnyHarnessQueryTimingOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const query = options.query ?? "";
  const limit = options.limit ?? 50;
  const enabled = (options.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessWorkspaceFileSearchKey(runtimeUrl, workspaceId, query, limit);
  useReportAnyHarnessCacheDecision({
    category: "file.search",
    enabled,
    queryKey,
    onCacheDecision: options.onCacheDecision,
  });

  return useQuery({
    queryKey,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.search(
        resolved.connection.anyharnessWorkspaceId,
        query,
        limit,
        requestOptionsWithSignal(options.requestOptions, signal),
      );
    },
  });
}

export function useStatWorkspaceFileQuery(options: {
  workspaceId?: string | null;
  path: string | null;
  enabled?: boolean;
} & AnyHarnessQueryTimingOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const enabled = (options.enabled ?? true) && !!workspaceId && !!options.path;
  const queryKey = anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, options.path);
  useReportAnyHarnessCacheDecision({
    category: "file.stat",
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
      return client.files.stat(
        resolved.connection.anyharnessWorkspaceId,
        options.path!,
        requestOptionsWithSignal(options.requestOptions, signal),
      );
    },
  });
}

export function useWriteWorkspaceFileMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: WriteWorkspaceFileRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.write(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async (_response, input) => {
      const parentPath = parentDirectoryPath(input.path);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, parentPath),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessGitStatusKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessGitDiffScopeKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}

export function useCreateWorkspaceFileMutation(options?: { workspaceId?: string | null }) {
  return useCreateWorkspaceEntryMutation("file", options);
}

export function useCreateWorkspaceDirectoryMutation(options?: { workspaceId?: string | null }) {
  return useCreateWorkspaceEntryMutation("directory", options);
}

export function useRenameWorkspaceEntryMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: RenameWorkspaceFileEntryRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.renameEntry(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async (response, input) => {
      const oldParentPath = parentDirectoryPath(input.path);
      const newParentPath = parentDirectoryPath(response.entry.path);
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, oldParentPath),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, newParentPath),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, response.entry.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, response.entry.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessGitStatusKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessGitDiffScopeKey(runtimeUrl, workspaceId),
        }),
      ];
      if (response.entry.kind === "directory") {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessWorkspaceFilesScopeKey(runtimeUrl, workspaceId),
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });
}

export function useDeleteWorkspaceEntryMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { path: string }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.deleteEntry(resolved.connection.anyharnessWorkspaceId, input.path);
    },
    onSuccess: async (response, input) => {
      const parentPath = parentDirectoryPath(input.path);
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, parentPath),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessGitStatusKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessGitDiffScopeKey(runtimeUrl, workspaceId),
        }),
      ];
      if (response.kind === "directory") {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessWorkspaceFilesScopeKey(runtimeUrl, workspaceId),
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });
}

function useCreateWorkspaceEntryMutation(
  kind: "file" | "directory",
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { path: string; content?: string }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.createEntry(resolved.connection.anyharnessWorkspaceId, {
        kind,
        path: input.path,
        ...(kind === "file" ? { content: input.content ?? "" } : {}),
      });
    },
    onSuccess: async (response, input) => {
      const parentPath = parentDirectoryPath(input.path);
      if (kind === "file" && response.file) {
        queryClient.setQueryData(
          anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, input.path),
          response.file satisfies ReadWorkspaceFileResponse,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, parentPath),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
        }),
        kind === "file"
          ? queryClient.invalidateQueries({
              queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, input.path),
            })
          : Promise.resolve(),
        kind === "file"
          ? queryClient.invalidateQueries({
              queryKey: anyHarnessGitStatusKey(runtimeUrl, workspaceId),
            })
          : Promise.resolve(),
        kind === "file"
          ? queryClient.invalidateQueries({
              queryKey: anyHarnessGitDiffScopeKey(runtimeUrl, workspaceId),
            })
          : Promise.resolve(),
      ]);
    },
  });
}

function parentDirectoryPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}
