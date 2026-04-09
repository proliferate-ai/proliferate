import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { WriteWorkspaceFileRequest } from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessWorkspaceFileKey,
  anyHarnessWorkspaceFileSearchKey,
  anyHarnessWorkspaceFileSearchScopeKey,
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
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const path = options.path ?? "";

  return useQuery({
    queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, path),
    enabled: (options.enabled ?? true) && !!workspaceId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.list(resolved.connection.anyharnessWorkspaceId, path);
    },
  });
}

export function useReadWorkspaceFileQuery(options: {
  workspaceId?: string | null;
  path: string | null;
  enabled?: boolean;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, options.path),
    enabled: (options.enabled ?? true) && !!workspaceId && !!options.path,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.read(resolved.connection.anyharnessWorkspaceId, options.path!);
    },
  });
}

export function useSearchWorkspaceFilesQuery(options: {
  workspaceId?: string | null;
  query?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;
  const query = options.query ?? "";
  const limit = options.limit ?? 50;

  return useQuery({
    queryKey: anyHarnessWorkspaceFileSearchKey(runtimeUrl, workspaceId, query, limit),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: (options.enabled ?? true) && !!workspaceId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.search(resolved.connection.anyharnessWorkspaceId, query, limit);
    },
  });
}

export function useStatWorkspaceFileQuery(options: {
  workspaceId?: string | null;
  path: string | null;
  enabled?: boolean;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, options.path),
    enabled: (options.enabled ?? true) && !!workspaceId && !!options.path,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.files.stat(resolved.connection.anyharnessWorkspaceId, options.path!);
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
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileStatKey(runtimeUrl, workspaceId, input.path),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileTreeKey(runtimeUrl, workspaceId, ""),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceFileSearchScopeKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}
