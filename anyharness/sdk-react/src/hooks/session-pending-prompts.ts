import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PromptInputBlock } from "@anyharness/sdk";

import {
  resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { anyHarnessSessionKey } from "../lib/query-keys.js";

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useEditPendingPromptMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (
      input: { sessionId: string; seq: number; text?: string; blocks?: PromptInputBlock[] },
    ) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.editPendingPrompt(input.sessionId, input.seq, {
        blocks: input.blocks,
        text: input.text,
      });
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
      });
    },
  });
}

export function useDeletePendingPromptMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; seq: number }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.deletePendingPrompt(input.sessionId, input.seq);
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
      });
    },
  });
}

export function useReorderPendingPromptsMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (
      input: { sessionId: string; expectedSeqs: number[]; desiredSeqs: number[] },
    ) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.reorderPendingPrompts(input.sessionId, {
        expectedSeqs: input.expectedSeqs,
        desiredSeqs: input.desiredSeqs,
      });
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
      });
    },
  });
}

export function useSteerPendingPromptMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; seq: number }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.steerPendingPrompt(input.sessionId, input.seq);
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
      });
    },
  });
}
