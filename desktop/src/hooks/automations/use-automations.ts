import { useQuery } from "@tanstack/react-query";
import type {
  AutomationListResponse,
  AutomationResponse,
  AutomationRunListResponse,
} from "@/lib/integrations/cloud/client";
import {
  getAutomation,
  listAutomationRuns,
  listAutomations,
} from "@/lib/integrations/cloud/automations";
import {
  automationDetailKey,
  automationRunsKey,
  automationsListKey,
} from "./query-keys";

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

export function useAutomations(enabled = true) {
  return useQuery<AutomationListResponse>({
    queryKey: automationsListKey(),
    queryFn: listAutomations,
    enabled,
  });
}

export function useAutomationDetail(automationId: string | null, enabled = true) {
  return useQuery<AutomationResponse>({
    queryKey: automationDetailKey(automationId),
    queryFn: () => getAutomation(automationId!),
    enabled: enabled && automationId !== null,
  });
}

export function useAutomationRuns(automationId: string | null, enabled = true) {
  return useQuery<AutomationRunListResponse>({
    queryKey: automationRunsKey(automationId),
    queryFn: () => listAutomationRuns(automationId!),
    enabled: enabled && automationId !== null,
    refetchInterval: (query) =>
      enabled && automationId !== null && hasActiveAutomationRun(query.state.data)
        ? 5000
        : false,
    refetchIntervalInBackground: false,
  });
}
