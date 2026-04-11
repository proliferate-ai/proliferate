import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCoworkThreadRequest } from "@anyharness/sdk";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessCoworkArtifactKey,
  anyHarnessCoworkManifestKey,
  anyHarnessCoworkStatusKey,
  anyHarnessCoworkThreadsKey,
  anyHarnessRepoRootsKey,
  anyHarnessRuntimeWorkspacesKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

export function useCoworkStatusQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessCoworkStatusKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async () => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.cowork.getStatus();
    },
  });
}

export function useCoworkThreadsQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessCoworkThreadsKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async () => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.cowork.listThreads();
    },
  });
}

export function useCoworkArtifactManifestQuery(
  workspaceId: string | null | undefined,
  options?: RuntimeQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessCoworkManifestKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0 && !!workspaceId,
    queryFn: async () => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.cowork.getManifest(workspaceId!);
    },
  });
}

export function useCoworkArtifactQuery(
  workspaceId: string | null | undefined,
  artifactId: string | null | undefined,
  options?: RuntimeQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessCoworkArtifactKey(runtimeUrl, workspaceId, artifactId),
    enabled:
      (options?.enabled ?? true) &&
      runtimeUrl.length > 0 &&
      !!workspaceId &&
      !!artifactId,
    queryFn: async () => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.cowork.getArtifact(workspaceId!, artifactId!);
    },
  });
}

export function useEnableCoworkMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.cowork.enable();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: anyHarnessCoworkStatusKey(runtimeUrl) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessCoworkThreadsKey(runtimeUrl) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessRepoRootsKey(runtimeUrl) }),
      ]);
    },
  });
}

export function useCreateCoworkThreadMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCoworkThreadRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.cowork.createThread(input);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: anyHarnessCoworkStatusKey(runtimeUrl) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessCoworkThreadsKey(runtimeUrl) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl) }),
      ]);
    },
  });
}
