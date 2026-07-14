import { useMemo } from "react";
import {
  attachLocalAutomationRunSession,
  attachLocalAutomationRunWorkspace,
  claimLocalAutomationRuns,
  heartbeatLocalAutomationRun,
  markLocalAutomationRunCreatingSession,
  markLocalAutomationRunCreatingWorkspace,
  markLocalAutomationRunDispatched,
  markLocalAutomationRunDispatching,
  markLocalAutomationRunFailed,
  markLocalAutomationRunProvisioningWorkspace,
} from "@proliferate/cloud-sdk/client/automations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";

export function useLocalAutomationRunClaims() {
  const cloudClient = useProductHost().cloud.client;
  return useMemo(() => ({
    claimRuns: (body: Parameters<typeof claimLocalAutomationRuns>[0]) =>
      claimLocalAutomationRuns(body, requireHostCloudClient(cloudClient)),
    heartbeatRun: (
      runId: string,
      body: Parameters<typeof heartbeatLocalAutomationRun>[1],
    ) => heartbeatLocalAutomationRun(runId, body, requireHostCloudClient(cloudClient)),
    markCreatingWorkspace: (
      runId: string,
      body: Parameters<typeof markLocalAutomationRunCreatingWorkspace>[1],
    ) => markLocalAutomationRunCreatingWorkspace(
      runId,
      body,
      requireHostCloudClient(cloudClient),
    ),
    attachWorkspace: (
      runId: string,
      body: Parameters<typeof attachLocalAutomationRunWorkspace>[1],
    ) => attachLocalAutomationRunWorkspace(runId, body, requireHostCloudClient(cloudClient)),
    markProvisioningWorkspace: (
      runId: string,
      body: Parameters<typeof markLocalAutomationRunProvisioningWorkspace>[1],
    ) => markLocalAutomationRunProvisioningWorkspace(
      runId,
      body,
      requireHostCloudClient(cloudClient),
    ),
    markCreatingSession: (
      runId: string,
      body: Parameters<typeof markLocalAutomationRunCreatingSession>[1],
    ) => markLocalAutomationRunCreatingSession(
      runId,
      body,
      requireHostCloudClient(cloudClient),
    ),
    attachSession: (
      runId: string,
      body: Parameters<typeof attachLocalAutomationRunSession>[1],
    ) => attachLocalAutomationRunSession(runId, body, requireHostCloudClient(cloudClient)),
    markDispatching: (
      runId: string,
      body: Parameters<typeof markLocalAutomationRunDispatching>[1],
    ) => markLocalAutomationRunDispatching(runId, body, requireHostCloudClient(cloudClient)),
    markDispatched: (
      runId: string,
      body: Parameters<typeof markLocalAutomationRunDispatched>[1],
    ) => markLocalAutomationRunDispatched(runId, body, requireHostCloudClient(cloudClient)),
    markFailed: (
      runId: string,
      body: Parameters<typeof markLocalAutomationRunFailed>[1],
    ) => markLocalAutomationRunFailed(runId, body, requireHostCloudClient(cloudClient)),
  }), [cloudClient]);
}
