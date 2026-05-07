import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnyHarnessRequestOptions,
  CreateSessionRequest,
  ForkSessionRequest,
  ListSessionEventsOptions,
  PromptInputBlock,
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
  type AnyHarnessQueryTimingOptions,
  useReportAnyHarnessCacheDecision,
} from "../lib/timing-options.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessSessionEventsKey,
  anyHarnessSessionKey,
  anyHarnessSessionLiveConfigKey,
  anyHarnessSessionSubagentsKey,
  anyHarnessSessionsKey,
} from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

interface WorkspaceMutationInput {
  workspaceId?: string | null;
}

type TimedWorkspaceQueryOptions = WorkspaceQueryOptions & AnyHarnessQueryTimingOptions;

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useWorkspaceSessionsQuery(options?: TimedWorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const enabled = (options?.enabled ?? true) && !!workspaceId;
  const queryKey = anyHarnessSessionsKey(runtimeUrl, workspaceId);
  useReportAnyHarnessCacheDecision({
    category: "session.list",
    enabled,
    queryKey,
    onCacheDecision: options?.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.list(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(options?.requestOptions, signal),
      );
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
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.get(sessionId!, requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function useFetchSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (input: {
      workspaceId?: string | null;
      sessionId: string;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.get(input.sessionId, input.requestOptions);
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
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.getLiveConfig(
        sessionId!,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function useSessionEventsQuery(
  sessionId: string | null | undefined,
  options?: TimedWorkspaceQueryOptions & { request?: ListSessionEventsOptions },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const afterSeq = options?.request?.afterSeq;
  const beforeSeq = options?.request?.beforeSeq;
  const limit = options?.request?.limit;
  const turnLimit = options?.request?.turnLimit;
  const enabled = (options?.enabled ?? true) && !!workspaceId && !!sessionId;
  const queryKey = anyHarnessSessionEventsKey(
    runtimeUrl,
    workspaceId,
    sessionId,
    afterSeq,
    limit,
    beforeSeq,
    turnLimit,
  );
  useReportAnyHarnessCacheDecision({
    category: "session.events.list",
    enabled,
    queryKey,
    onCacheDecision: options?.onCacheDecision,
  });

  return useQuery({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.listEvents(
        sessionId!,
        options?.request || options?.requestOptions
          ? {
            ...options?.request,
            request: requestOptionsWithSignal(options?.requestOptions, signal),
          }
          : {
            request: requestOptionsWithSignal(undefined, signal),
          },
      );
    },
  });
}

export function useSessionSubagentsQuery(
  sessionId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, workspaceId, sessionId),
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

export function useScheduleSubagentWakeMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; childSessionId: string }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.scheduleSubagentWake(input.sessionId, input.childSessionId);
    },
    onSuccess: async (_response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, workspaceId, variables.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, workspaceId, variables.childSessionId),
        }),
      ]);
    },
  });
}

export function useCreateSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: CreateSessionRequest | {
        workspaceId?: string | null;
        request: CreateSessionRequest;
        requestOptions?: AnyHarnessRequestOptions;
      },
    ) => {
      const request = "request" in input ? input.request : input;
      const systemPromptAppend = (request as { systemPromptAppend?: string[] }).systemPromptAppend;
      console.debug("[anyharness sdk-react] createSession", {
        workspaceId: request.workspaceId,
        agentKind: request.agentKind,
        modelId: request.modelId,
        hasSystemPromptAppend: !!systemPromptAppend?.length,
        systemPromptAppend,
      });
      const workspaceId = "request" in input
        ? input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId
        : options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.create(request, "request" in input ? input.requestOptions : undefined);
    },
    onSuccess: async (_response, input) => {
      const workspaceId = "request" in input
        ? input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId
        : options?.workspaceId ?? workspace.workspaceId;
      await queryClient.invalidateQueries({
        queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useSetSessionConfigOptionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: WorkspaceMutationInput & {
        sessionId: string;
        request: SetSessionConfigOptionRequest;
      },
    ) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.setConfigOption(input.sessionId, input.request);
    },
    onSuccess: async (_response, variables) => {
      const workspaceId = variables.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

  return useMutation({
    mutationFn: async (
      input: WorkspaceMutationInput & {
        sessionId: string;
        request: PromptSessionRequest;
        requestOptions?: AnyHarnessRequestOptions;
      },
    ) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.prompt(input.sessionId, input.request, input.requestOptions);
    },
    onSuccess: async (_response, variables) => {
      const workspaceId = variables.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

export function useForkSessionMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { sessionId: string; request?: ForkSessionRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.fork(input.sessionId, input.request ?? {});
    },
    onSuccess: async (response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, variables.sessionId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionKey(runtimeUrl, workspaceId, response.session.id),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionEventsKey(runtimeUrl, workspaceId, response.session.id),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
        }),
      ]);
    },
  });
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

  return useMutation({
    mutationFn: async (
      input: WorkspaceMutationInput & {
        sessionId: string;
        request: UpdateSessionTitleRequest;
        requestOptions?: AnyHarnessRequestOptions;
      },
    ) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.updateTitle(input.sessionId, input.request, input.requestOptions);
    },
    onSuccess: async (_response, variables) => {
      const workspaceId = variables.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

  return useMutation({
    mutationFn: async (input: string | (WorkspaceMutationInput & { sessionId: string })) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const workspaceId = typeof input === "string"
        ? options?.workspaceId ?? workspace.workspaceId
        : input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.cancel(sessionId);
    },
    onSuccess: async (_response, input) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const workspaceId = typeof input === "string"
        ? options?.workspaceId ?? workspace.workspaceId
        : input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

  return useMutation({
    mutationFn: async (input: string | (WorkspaceMutationInput & { sessionId: string })) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const workspaceId = typeof input === "string"
        ? options?.workspaceId ?? workspace.workspaceId
        : input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.dismiss(sessionId);
    },
    onSuccess: async (_response, input) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const workspaceId = typeof input === "string"
        ? options?.workspaceId ?? workspace.workspaceId
        : input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

  return useMutation({
    mutationFn: async (input: string | (WorkspaceMutationInput & { sessionId: string })) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const workspaceId = typeof input === "string"
        ? options?.workspaceId ?? workspace.workspaceId
        : input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.close(sessionId);
    },
    onSuccess: async (_response, input) => {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const workspaceId = typeof input === "string"
        ? options?.workspaceId ?? workspace.workspaceId
        : input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

  return useMutation({
    mutationFn: async (input?: WorkspaceMutationInput & {
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const workspaceId = input?.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.restoreDismissed(
        resolved.connection.anyharnessWorkspaceId,
        input?.requestOptions,
      );
    },
    onSuccess: async (response, input) => {
      const workspaceId = input?.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
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

  return useMutation({
    mutationFn: async (input: {
      workspaceId?: string | null;
      sessionId: string;
      requestId: string;
      request: ResolveInteractionRequest;
    }) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      await client.sessions.resolveInteraction(input.sessionId, input.requestId, input.request);
    },
  });
}

export function useRevealMcpElicitationUrlMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (input: {
      workspaceId?: string | null;
      sessionId: string;
      requestId: string;
    }) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.revealMcpElicitationUrl(input.sessionId, input.requestId);
    },
  });
}

export function useFetchPromptAttachmentMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (input: {
      workspaceId?: string | null;
      sessionId: string;
      attachmentId: string;
    }) => {
      const workspaceId = input.workspaceId ?? options?.workspaceId ?? workspace.workspaceId;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.sessions.fetchPromptAttachment(input.sessionId, input.attachmentId);
    },
  });
}
