import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MarkReviewRevisionReadyRequest,
  StartCodeReviewRequest,
  StartPlanReviewRequest,
} from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessReviewAssignmentCritiqueKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
  anyHarnessSessionsKey,
} from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

function useWorkspaceId(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  return options?.workspaceId ?? workspace.workspaceId;
}

async function invalidateSessionReviews(
  queryClient: ReturnType<typeof useQueryClient>,
  runtimeUrl: string,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  if (!sessionId) return;
  // V1 review sessions are direct children of the parent session, so the direct
  // subagent summary query is the only linked-session hierarchy that changes.
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: anyHarnessSessionReviewsKey(runtimeUrl, workspaceId, sessionId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, workspaceId, sessionId),
    }),
    queryClient.invalidateQueries({
      queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
    }),
  ]);
}

export function useSessionReviewsQuery(
  sessionId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = useWorkspaceId(options);

  return useQuery({
    queryKey: anyHarnessSessionReviewsKey(runtimeUrl, workspaceId, sessionId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!sessionId,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.listForSession(sessionId!);
    },
  });
}

export function useReviewAssignmentCritiqueQuery(
  reviewRunId: string | null | undefined,
  assignmentId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = useWorkspaceId(options);

  return useQuery({
    queryKey: anyHarnessReviewAssignmentCritiqueKey(
      runtimeUrl,
      workspaceId,
      reviewRunId,
      assignmentId,
    ),
    enabled:
      (options?.enabled ?? true) &&
      !!workspaceId &&
      !!reviewRunId &&
      !!assignmentId,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    queryFn: async () => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.getAssignmentCritique(reviewRunId!, assignmentId!);
    },
  });
}

export function useStartPlanReviewMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = useWorkspaceId(options);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { planId: string; request: StartPlanReviewRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.startPlanReview(
        resolved.connection.anyharnessWorkspaceId,
        input.planId,
        input.request,
      );
    },
    onSuccess: async (response) => {
      await invalidateSessionReviews(
        queryClient,
        runtimeUrl,
        workspaceId,
        response.run.parentSessionId,
      );
    },
  });
}

export function useStartCodeReviewMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = useWorkspaceId(options);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: StartCodeReviewRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.startCodeReview(
        resolved.connection.anyharnessWorkspaceId,
        request,
      );
    },
    onSuccess: async (response) => {
      await invalidateSessionReviews(
        queryClient,
        runtimeUrl,
        workspaceId,
        response.run.parentSessionId,
      );
    },
  });
}

export function useStopReviewMutation(options?: { workspaceId?: string | null }) {
  const workspaceId = useWorkspaceId(options);
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (reviewRunId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.stop(reviewRunId);
    },
    onSuccess: async (response) => {
      await invalidateSessionReviews(
        queryClient,
        runtimeUrl,
        workspaceId,
        response.run.parentSessionId,
      );
    },
  });
}

export function useSendReviewFeedbackMutation(options?: { workspaceId?: string | null }) {
  const workspaceId = useWorkspaceId(options);
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (reviewRunId: string) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.sendFeedback(reviewRunId);
    },
    onSuccess: async (response) => {
      await invalidateSessionReviews(
        queryClient,
        runtimeUrl,
        workspaceId,
        response.run.parentSessionId,
      );
    },
  });
}

export function useMarkReviewRevisionReadyMutation(
  options?: { workspaceId?: string | null },
) {
  const workspaceId = useWorkspaceId(options);
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspace = useAnyHarnessWorkspaceContext();

  return useMutation({
    mutationFn: async (
      input: { reviewRunId: string; request?: MarkReviewRevisionReadyRequest },
    ) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.reviews.markRevisionReady(input.reviewRunId, input.request ?? {});
    },
    onSuccess: async (response) => {
      await invalidateSessionReviews(
        queryClient,
        runtimeUrl,
        workspaceId,
        response.run.parentSessionId,
      );
    },
  });
}
