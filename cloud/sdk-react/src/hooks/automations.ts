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

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "claimed",
  "creating_workspace",
  "provisioning_workspace",
  "creating_session",
  "dispatching",
]);

function hasActiveAutomationRun(
  data: AutomationRunListResponse | undefined,
): boolean {
  return data?.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? false;
}

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
    refetchInterval: (query) =>
      enabled && automationId !== null && hasActiveAutomationRun(query.state.data)
        ? 5000
        : false,
    refetchIntervalInBackground: false,
  });
}
