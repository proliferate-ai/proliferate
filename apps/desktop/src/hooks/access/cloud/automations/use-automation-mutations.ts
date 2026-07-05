import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationResponse,
  AutomationRunResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/access/cloud/client";
import {
  archiveAutomation,
  createAutomation,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
  updateAutomation,
} from "@proliferate/cloud-sdk/client/automations";
import {
  automationDetailKey,
  automationRunsKey,
  automationsRootKey,
} from "./query-keys";

export function useAutomationMutations() {
  const queryClient = useQueryClient();

  const invalidateAutomation = useCallback(async (automationId?: string) => {
    await queryClient.invalidateQueries({ queryKey: automationsRootKey() });
    if (!automationId) {
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: automationDetailKey(automationId) }),
      queryClient.invalidateQueries({ queryKey: automationRunsKey(automationId) }),
    ]);
  }, [queryClient]);

  const createMutation = useMutation<AutomationResponse, Error, CreateAutomationRequest>({
    mutationFn: (body) => createAutomation(body),
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
    mutationFn: (automationId) => pauseAutomation(automationId),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const resumeMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: (automationId) => resumeAutomation(automationId),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const runNowMutation = useMutation<AutomationRunResponse, Error, string>({
    mutationFn: (automationId) => runAutomationNow(automationId),
    onSuccess: (_, automationId) => invalidateAutomation(automationId),
  });

  const archiveMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: (automationId) => archiveAutomation(automationId),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  return {
    createMutation,
    updateMutation,
    pauseMutation,
    resumeMutation,
    runNowMutation,
    archiveMutation,
    invalidateAutomation,
  };
}
