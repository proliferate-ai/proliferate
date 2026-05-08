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
} from "@/lib/access/cloud/automations";

export function useLocalAutomationRunClaims() {
  return useMemo(() => ({
    claimRuns: claimLocalAutomationRuns,
    heartbeatRun: heartbeatLocalAutomationRun,
    markCreatingWorkspace: markLocalAutomationRunCreatingWorkspace,
    attachWorkspace: attachLocalAutomationRunWorkspace,
    markProvisioningWorkspace: markLocalAutomationRunProvisioningWorkspace,
    markCreatingSession: markLocalAutomationRunCreatingSession,
    attachSession: attachLocalAutomationRunSession,
    markDispatching: markLocalAutomationRunDispatching,
    markDispatched: markLocalAutomationRunDispatched,
    markFailed: markLocalAutomationRunFailed,
  }), []);
}
