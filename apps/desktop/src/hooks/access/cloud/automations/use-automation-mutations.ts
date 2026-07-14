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
} from "@proliferate/cloud-sdk/client/automations";
import {
  automationDetailKey,
  automationRunsKey,
  automationsRootKey,
} from "./query-keys";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";

export function useAutomationMutations() {
  const queryClient = useQueryClient();
  const cloudClient = useProductHost().cloud.client;

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
    mutationFn: (body) => createAutomation(body, requireHostCloudClient(cloudClient)),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const updateMutation = useMutation<AutomationResponse, Error, {
    automationId: string;
    body: UpdateAutomationRequest;
  }>({
    mutationFn: ({ automationId, body }) =>
      updateAutomation(automationId, body, requireHostCloudClient(cloudClient)),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const pauseMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: (automationId) =>
      pauseAutomation(automationId, requireHostCloudClient(cloudClient)),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const resumeMutation = useMutation<AutomationResponse, Error, string>({
    mutationFn: (automationId) =>
      resumeAutomation(automationId, requireHostCloudClient(cloudClient)),
    onSuccess: (automation) => invalidateAutomation(automation.id),
  });

  const runNowMutation = useMutation<AutomationRunResponse, Error, string>({
    mutationFn: (automationId) =>
      runAutomationNow(automationId, requireHostCloudClient(cloudClient)),
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
