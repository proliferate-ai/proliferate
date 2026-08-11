import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnyHarnessCacheScopeKey } from "../context/AnyHarnessRuntime.js";
import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "../context/AnyHarnessWorkspace.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessSessionKey,
  anyHarnessSessionSubagentsKey,
  anyHarnessSessionsKey,
  anyHarnessWorkspaceSubagentsKey,
} from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

type SubagentLifecycleMutationInput = {
  parentSessionId: string;
  childSessionId: string;
};

export function useSessionSubagentsQuery(
  sessionId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessSessionSubagentsKey(cacheScopeKey, workspaceId, sessionId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!sessionId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.getSubagents(
        sessionId!,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

function useSubagentLifecycleMutation(
  action: "closeSubagent" | "openSubagent" | "promoteSubagent",
  options?: { workspaceId?: string | null },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: SubagentLifecycleMutationInput) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions[action](input.parentSessionId, input.childSessionId);
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessWorkspaceSubagentsKey(cacheScopeKey, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionSubagentsKey(
            cacheScopeKey,
            workspaceId,
            variables.parentSessionId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionSubagentsKey(cacheScopeKey, workspaceId, variables.childSessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionKey(cacheScopeKey, workspaceId, variables.childSessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(cacheScopeKey, workspaceId),
        }),
      ]);
    },
  });
}

export function useCloseSubagentMutation(options?: { workspaceId?: string | null }) {
  return useSubagentLifecycleMutation("closeSubagent", options);
}

export function useOpenSubagentMutation(options?: { workspaceId?: string | null }) {
  return useSubagentLifecycleMutation("openSubagent", options);
}

export function usePromoteSubagentMutation(options?: { workspaceId?: string | null }) {
  return useSubagentLifecycleMutation("promoteSubagent", options);
}
