import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnyHarnessRequestOptions,
  InstallSkillRequest,
  UpdateWorkspaceSkillRequest,
} from "@anyharness/sdk";
import {
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "../context/AnyHarnessRuntime.js";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "../context/AnyHarnessWorkspace.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessMarketplaceSkillsKey,
  anyHarnessMarketplaceSkillsScopeKey,
  anyHarnessSkillsKey,
  anyHarnessWorkspaceSkillsKey,
} from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
  requestOptions?: AnyHarnessRequestOptions;
}

interface MarketplaceSkillsQueryOptions extends RuntimeQueryOptions {
  query: string;
  limit?: number;
}

interface WorkspaceSkillsQueryOptions extends RuntimeQueryOptions {
  workspaceId?: string | null;
}

function useRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useAnyHarnessInstalledSkillsQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessSkillsKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.skills.list(requestOptionsWithSignal(options?.requestOptions, signal));
    },
  });
}

export function useAnyHarnessMarketplaceSkillsQuery(
  options: MarketplaceSkillsQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const query = options.query.trim();

  return useQuery({
    queryKey: anyHarnessMarketplaceSkillsKey(runtimeUrl, query, options.limit ?? null),
    enabled:
      (options.enabled ?? true) &&
      runtimeUrl.length > 0 &&
      query.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.skills.searchMarketplace(query, {
        limit: options.limit,
        requestOptions: requestOptionsWithSignal(options.requestOptions, signal),
      });
    },
  });
}

export function useAnyHarnessInstallSkillMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (request: InstallSkillRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.skills.install(request);
    },
    onSuccess: async (_data, request) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSkillsKey(runtimeUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessMarketplaceSkillsScopeKey(runtimeUrl),
        }),
        request.enableForWorkspaceId
          ? queryClient.invalidateQueries({
              queryKey: anyHarnessWorkspaceSkillsKey(
                runtimeUrl,
                request.enableForWorkspaceId,
              ),
            })
          : Promise.resolve(),
      ]);
    },
  });
}

export function useAnyHarnessDeleteSkillMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (skillId: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.skills.delete(skillId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSkillsKey(runtimeUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessMarketplaceSkillsScopeKey(runtimeUrl),
        }),
      ]);
    },
  });
}

export function useAnyHarnessWorkspaceSkillsQuery(
  options?: WorkspaceSkillsQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessWorkspaceSkillsKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.skills.listWorkspace(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
    },
  });
}

export function useAnyHarnessUpdateWorkspaceSkillMutation() {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useRuntimeUrl();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workspaceId,
      skillId,
      request,
      requestOptions,
    }: {
      workspaceId: string;
      skillId: string;
      request: UpdateWorkspaceSkillRequest;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.skills.updateWorkspaceSkill(
        resolved.connection.anyharnessWorkspaceId,
        skillId,
        request,
        requestOptions,
      );
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorkspaceSkillsKey(runtimeUrl, variables.workspaceId),
      });
    },
  });
}
