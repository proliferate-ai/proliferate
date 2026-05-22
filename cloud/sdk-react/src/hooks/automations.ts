import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAutomation,
  getAutomation,
  listAutomationRuns,
  listAutomations,
  pauseAutomationWithClient,
  resumeAutomationWithClient,
  runAutomationNowWithClient,
  updateAutomation,
  type AutomationListResponse,
  type AutomationResponse,
  type AutomationRunListResponse,
  type AutomationRunResponse,
  type CreateAutomationRequest,
  type ListAutomationsOptions,
  type UpdateAutomationRequest,
} from "@proliferate/cloud-sdk";
import {
  automationDetailKey,
  automationRunsKey,
  automationsListKey,
  automationsRootKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useAutomations(optionsOrEnabled: UseAutomationsOptions | boolean = true) {
  const client = useCloudClient();
  return useAutomationsQuery(
    typeof optionsOrEnabled === "boolean" ? { enabled: optionsOrEnabled } : optionsOrEnabled,
    client,
  );
}

export interface UseAutomationsOptions extends ListAutomationsOptions {
  enabled?: boolean;
}

function useAutomationsQuery(
  options: UseAutomationsOptions,
  client: ReturnType<typeof useCloudClient>,
) {
  const { enabled = true, ...listOptions } = options;
  return useQuery<AutomationListResponse>({
    queryKey: automationsListKey(listOptions),
    queryFn: () => listAutomations(listOptions, client),
    enabled,
  });
}

export function useAutomationDetail(automationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<AutomationResponse>({
    queryKey: automationDetailKey(automationId),
    queryFn: () => getAutomation(automationId!, client),
    enabled: enabled && automationId !== null,
  });
}

export function useAutomationRuns(automationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<AutomationRunListResponse>({
    queryKey: automationRunsKey(automationId),
    queryFn: () => listAutomationRuns(automationId!, 50, client),
    enabled: enabled && automationId !== null,
    refetchInterval: enabled && automationId !== null ? 3000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useAutomationActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  const invalidateAutomation = async (automationId?: string) => {
    await queryClient.invalidateQueries({ queryKey: automationsRootKey() });
    if (!automationId) {
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: automationDetailKey(automationId) }),
      queryClient.invalidateQueries({ queryKey: automationRunsKey(automationId) }),
    ]);
  };

  const createMutation = useMutation<AutomationResponse, Error, CreateAutomationRequest>({
    mutationFn: (body) => createAutomation(body, client),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const updateMutation = useMutation<
    AutomationResponse,
    Error,
    { automationId: string; body: UpdateAutomationRequest }
  >({
    mutationFn: ({ automationId, body }) => updateAutomation(automationId, body, client),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const pauseMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: (automationId) => pauseAutomationWithClient(automationId, client),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const resumeMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: (automationId) => resumeAutomationWithClient(automationId, client),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const runNowMutation = useMutation<AutomationRunResponse, Error, string>({
    mutationFn: (automationId) => runAutomationNowWithClient(automationId, client),
    onSuccess: (_, automationId) => invalidateAutomation(automationId),
  });

  return {
    createAutomation: createMutation.mutateAsync,
    creatingAutomation: createMutation.isPending,
    updateAutomation: updateMutation.mutateAsync,
    updatingAutomation: updateMutation.isPending,
    pauseAutomation: pauseMutation.mutateAsync,
    pausingAutomation: pauseMutation.isPending,
    resumeAutomation: resumeMutation.mutateAsync,
    resumingAutomation: resumeMutation.isPending,
    runAutomationNow: runNowMutation.mutateAsync,
    runningAutomationNow: runNowMutation.isPending,
    invalidateAutomation,
  };
}
