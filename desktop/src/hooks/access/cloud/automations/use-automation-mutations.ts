import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationResponse,
  AutomationRunResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/access/cloud/client";
import {
  createAutomation,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
  updateAutomation,
} from "@/lib/access/cloud/automations";
import {
  automationDetailKey,
  automationRunsKey,
  automationsListKey,
} from "./query-keys";

export function useAutomationMutations() {
  const queryClient = useQueryClient();

  const invalidateAutomation = useCallback(async (automationId?: string) => {
    await queryClient.invalidateQueries({ queryKey: automationsListKey() });
    if (!automationId) {
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: automationDetailKey(automationId) }),
      queryClient.invalidateQueries({ queryKey: automationRunsKey(automationId) }),
    ]);
  }, [queryClient]);

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
  });

  const resumeMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: resumeAutomation,
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const runNowMutation = useMutation<AutomationRunResponse, Error, string>({
    mutationFn: runAutomationNow,
    onSuccess: (_, automationId) => invalidateAutomation(automationId),
  });

  return {
    createMutation,
    updateMutation,
    pauseMutation,
    resumeMutation,
    runNowMutation,
    invalidateAutomation,
  };
}
