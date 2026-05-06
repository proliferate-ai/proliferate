import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnyHarnessError, type HandoffPlanRequest } from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import { useAnyHarnessRuntimeContext } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessPlanDocumentKey,
  anyHarnessPlanKey,
  anyHarnessPlansKey,
  anyHarnessSessionEventsKey,
} from "../lib/query-keys.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useWorkspacePlansQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessPlansKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.list(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function usePlanDetailQuery(
  planId: string | null | undefined,
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, planId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!planId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.get(
        resolved.connection.anyharnessWorkspaceId,
        planId!,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function usePlanDetailsQueries(
  planIds: readonly (string | null | undefined)[],
  options?: WorkspaceQueryOptions,
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQueries({
    queries: planIds.map((planId) => ({
      queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, planId),
      enabled: (options?.enabled ?? true) && !!workspaceId && !!planId,
      queryFn: async ({ signal }) => {
        const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
        const client = getAnyHarnessClient(resolved.connection);
        return client.plans.get(
          resolved.connection.anyharnessWorkspaceId,
          planId!,
          requestOptionsWithSignal(undefined, signal),
        );
      },
    })),
  });
}

export function usePlanDocumentQuery(
  planId: string | null | undefined,
  options?: WorkspaceQueryOptions & { materialize?: boolean },
) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const materialize = options?.materialize ?? false;

  return useQuery({
    queryKey: anyHarnessPlanDocumentKey(runtimeUrl, workspaceId, planId, materialize),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!planId,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.getDocument(resolved.connection.anyharnessWorkspaceId, planId!, {
        materialize,
        ...requestOptionsWithSignal(undefined, signal),
      });
    },
  });
}

export function useMaterializePlanDocumentMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { planId: string }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.getDocument(resolved.connection.anyharnessWorkspaceId, input.planId, {
        materialize: true,
      });
    },
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessPlanDocumentKey(runtimeUrl, workspaceId, variables.planId, true),
      });
    },
  });
}

export function useApprovePlanMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { planId: string; expectedDecisionVersion: number }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.approve(resolved.connection.anyharnessWorkspaceId, input.planId, {
        expectedDecisionVersion: input.expectedDecisionVersion,
      });
    },
    onSuccess: async (response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlansKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, variables.planId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionEventsKey(
            runtimeUrl,
            workspaceId,
            response.plan.sessionId,
          ),
        }),
      ]);
    },
    onError: async (error, variables) => {
      if (!isPlanDecisionVersionConflict(error)) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlansKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, variables.planId),
        }),
      ]);
    },
  });
}

export function useRejectPlanMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { planId: string; expectedDecisionVersion: number }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.reject(resolved.connection.anyharnessWorkspaceId, input.planId, {
        expectedDecisionVersion: input.expectedDecisionVersion,
      });
    },
    onSuccess: async (response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlansKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, variables.planId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionEventsKey(
            runtimeUrl,
            workspaceId,
            response.plan.sessionId,
          ),
        }),
      ]);
    },
    onError: async (error, variables) => {
      if (!isPlanDecisionVersionConflict(error)) return;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlansKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, variables.planId),
        }),
      ]);
    },
  });
}

export function useHandoffPlanMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const queryClient = useQueryClient();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: { planId: string; request: HandoffPlanRequest }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.plans.handoff(
        resolved.connection.anyharnessWorkspaceId,
        input.planId,
        input.request,
      );
    },
    onSuccess: async (response, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlansKey(runtimeUrl, workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessPlanKey(runtimeUrl, workspaceId, variables.planId),
        }),
        queryClient.invalidateQueries({
          queryKey: anyHarnessSessionEventsKey(
            runtimeUrl,
            workspaceId,
            response.targetSessionId,
          ),
        }),
      ]);
    },
  });
}

function isPlanDecisionVersionConflict(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && error.problem.status === 409
    && error.problem.code === "PLAN_DECISION_VERSION_CONFLICT";
}
