import { useQuery } from "@tanstack/react-query";
import {
  getAutomation,
  listAutomationRuns,
  listAutomations,
  type AutomationListResponse,
  type AutomationResponse,
  type AutomationRunListResponse,
  type ListAutomationsOptions,
} from "@proliferate/cloud-sdk";
import {
  automationDetailKey,
  automationRunsKey,
  automationsListKey,
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
