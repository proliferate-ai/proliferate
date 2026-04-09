import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTerminalRequest, ResizeTerminalRequest } from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { anyHarnessTerminalsKey } from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useTerminalsQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.terminals.list(resolved.connection.anyharnessWorkspaceId);
    },
  });
}

export function useCreateTerminalMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: CreateTerminalRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.terminals.create(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useResizeTerminalMutation() {
  return useMutation({
    mutationFn: async (input: {
      connection: { runtimeUrl: string; authToken?: string | null };
      terminalId: string;
      request: ResizeTerminalRequest;
    }) => {
      const client = getAnyHarnessClient(input.connection);
      return client.terminals.resize(input.terminalId, input.request);
    },
  });
}

export function useCloseTerminalMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: {
      connection: { runtimeUrl: string; authToken?: string | null };
      terminalId: string;
    }) => {
      const client = getAnyHarnessClient(input.connection);
      await client.terminals.close(input.terminalId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
      });
    },
  });
}
