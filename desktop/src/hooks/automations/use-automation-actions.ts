import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationResponse,
  AutomationRunResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/integrations/cloud/client";
import {
  createAutomation,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
  updateAutomation,
} from "@/lib/integrations/cloud/automations";
import {
  automationDetailKey,
  automationRunsKey,
  automationsListKey,
} from "./query-keys";
import { useToastStore } from "@/stores/toast/toast-store";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Automation action failed.";
}

export function useAutomationActions() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);

  const invalidateAutomation = async (automationId?: string) => {
    await queryClient.invalidateQueries({ queryKey: automationsListKey() });
    if (automationId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: automationDetailKey(automationId) }),
        queryClient.invalidateQueries({ queryKey: automationRunsKey(automationId) }),
      ]);
    }
  };

  const createMutation = useMutation<AutomationResponse, Error, CreateAutomationRequest>({
    mutationFn: createAutomation,
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const updateMutation = useMutation<AutomationResponse, Error, {
    automationId: string;
    body: UpdateAutomationRequest;
  }>({
    mutationFn: ({ automationId, body }) => updateAutomation(automationId, body),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const pauseMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: pauseAutomation,
    onSuccess: (automation) => invalidateAutomation(automation.id),
    onError: (error) => showToast(`Failed to pause automation: ${errorMessage(error)}`),
  });

  const resumeMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: resumeAutomation,
    onSuccess: (automation) => invalidateAutomation(automation.id),
    onError: (error) => showToast(`Failed to resume automation: ${errorMessage(error)}`),
  });

  const runNowMutation = useMutation<AutomationRunResponse, Error, string>({
    mutationFn: runAutomationNow,
    onSuccess: (_, automationId) => invalidateAutomation(automationId),
    onError: (error) => showToast(`Failed to queue automation run: ${errorMessage(error)}`),
  });

  return {
    createAutomation: createMutation.mutateAsync,
    isCreatingAutomation: createMutation.isPending,
    updateAutomation: updateMutation.mutateAsync,
    isUpdatingAutomation: updateMutation.isPending,
    pauseAutomation: pauseMutation.mutate,
    isPausingAutomation: pauseMutation.isPending,
    resumeAutomation: resumeMutation.mutate,
    isResumingAutomation: resumeMutation.isPending,
    runAutomationNow: runNowMutation.mutate,
    isRunningAutomationNow: runNowMutation.isPending,
  };
}
