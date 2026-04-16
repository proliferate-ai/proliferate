import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSessionRequest,
  ListSessionEventsOptions,
  PromptSessionRequest,
  ResolveInteractionRequest,
  ResumeSessionRequest,
  SetSessionConfigOptionRequest,
  UpdateSessionTitleRequest,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessSessionEventsKey,
  anyHarnessSessionKey,
  anyHarnessSessionLiveConfigKey,
  anyHarnessSessionsKey,
} from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useWorkspaceSessionsQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.list(resolved.connection.anyharnessWorkspaceId);
    },
  });
}

export function useSessionQuery(
  sessionId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!sessionId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.get(sessionId!);
    },
  });
}

export function useSessionLiveConfigQuery(
  sessionId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessSessionLiveConfigKey(runtimeUrl, workspaceId, sessionId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!sessionId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.getLiveConfig(sessionId!);
    },
  });
}

export function useSessionEventsQuery(
  sessionId: string | null | undefined,
  options?: WorkspaceQueryOptions & { request?: ListSessionEventsOptions },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const afterSeq = options?.request?.afterSeq;

  return useQuery({
    queryKey: anyHarnessSessionEventsKey(runtimeUrl, workspaceId, sessionId, afterSeq),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!sessionId,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.listEvents(sessionId!, options?.request);
    },
  });
}

export function useCreateSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSessionRequest) => {
      const systemPromptAppend = (input as { systemPromptAppend?: string[] }).systemPromptAppend;
      console.debug("[anyharness sdk-react] createSession", {
        workspaceId: input.workspaceId,
        agentKind: input.agentKind,
        modelId: input.modelId,
        hasSystemPromptAppend: !!systemPromptAppend?.length,
        systemPromptAppend,
      });
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, options?.workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.create(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionsKey(runtimeUrl, options?.workspaceId ?? workspace.workspaceId),
      });
    },
  });
}

export function useSetSessionConfigOptionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; request: SetSessionConfigOptionRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.setConfigOption(input.sessionId, input.request);
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionLiveConfigKey(runtimeUrl, workspaceId, variables.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}

export function usePromptSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; request: PromptSessionRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.prompt(input.sessionId, input.request);
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionEventsKey(runtimeUrl, workspaceId, variables.sessionId),
      });
    },
  });
}

export function usePromptSessionTextMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; text: string }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.promptText(input.sessionId, input.text);
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionEventsKey(runtimeUrl, workspaceId, variables.sessionId),
      });
    },
  });
}

export function useEditPendingPromptMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; seq: number; text: string }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.editPendingPrompt(input.sessionId, input.seq, {
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

export function useResumeSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (
      input: string | { sessionId: string; request?: ResumeSessionRequest },
    ) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const request = typeof input === "string" ? undefined : input.request;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.resume(sessionId, request);
    },
    onSuccess: async (_response, input) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId) }),
      ]);
    },
  });
}

export function useUpdateSessionTitleMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; request: UpdateSessionTitleRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.updateTitle(input.sessionId, input.request);
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
}

export function useCancelSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.cancel(sessionId);
    },
    onSuccess: async (_response, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId) }),
      ]);
    },
  });
}

export function useDismissSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.dismiss(sessionId);
    },
    onSuccess: async (_response, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId) }),
      ]);
    },
  });
}

export function useCloseSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.close(sessionId);
    },
    onSuccess: async (_response, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, sessionId) }),
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId) }),
      ]);
    },
  });
}

export function useRestoreDismissedSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.restoreDismissed(resolved.connection.anyharnessWorkspaceId);
    },
    onSuccess: async (response) => {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId) }),
      ];
      if (response?.id) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, response.id),
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });
}

export function useResolveSessionInteractionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      requestId: string;
      request: ResolveInteractionRequest;
    }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.sessions.resolveInteraction(input.sessionId, input.requestId, input.request);
    },
  });
}
