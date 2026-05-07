import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateTerminalRequest,
  ResizeTerminalRequest,
  StartTerminalCommandRequest,
  UpdateTerminalTitleRequest,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { anyHarnessTerminalsKey } from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

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
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.terminals.list(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function useCreateTerminalMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();

  return useMutation({
    mutationFn: async (
      input: CreateTerminalRequest | { workspaceId?: string | null; request: CreateTerminalRequest },
    ) => {
      const request = "request" in input ? input.request : input;
      const workspaceId = "request" in input
        ? input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId
        : options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.terminals.create(resolved.connection.anyharnessWorkspaceId, request);
    },
    onSuccess: async (_response, input) => {
      const workspaceId = "request" in input
        ? input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId
        : options?.workspaceId ?? workspace.workspaceId;
      await queryClient.invalidateQueries({
        queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useListTerminalsMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (input?: { workspaceId?: string | null }) => {
      const workspaceId = input?.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.terminals.list(resolved.connection.anyharnessWorkspaceId);
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

export function useUpdateTerminalTitleMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: {
      connection: { runtimeUrl: string; authToken?: string | null };
      terminalId: string;
      request: UpdateTerminalTitleRequest;
    }) => {
      const client = getAnyHarnessClient(input.connection);
      return client.terminals.updateTitle(input.terminalId, input.request);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
      });
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

export function useRunTerminalCommandMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: {
      connection: { runtimeUrl: string; authToken?: string | null };
      terminalId: string;
      request: StartTerminalCommandRequest;
    }) => {
      const client = getAnyHarnessClient(input.connection);
      return client.terminals.runCommand(input.terminalId, input.request);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessTerminalsKey(runtimeUrl, workspaceId),
      });
    },
  });
}
