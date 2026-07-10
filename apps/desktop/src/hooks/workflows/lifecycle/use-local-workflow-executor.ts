import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useLocalWorkflowClaimPoller } from "@/hooks/access/cloud/workflows/use-local-workflow-claim-poller";

// Mounts the desktop workflow claim poller when cloud + the local runtime are
// ready — the same gate the automations executor uses (D-001: the two pollers
// coexist, each claiming from its own endpoints). Owns nothing else.
export function useLocalWorkflowExecutor(): void {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const { cloudActive } = useCloudAvailabilityState();
  const enabled =
    cloudActive
    && connectionState === "healthy"
    && runtimeUrl.trim().length > 0;

  useLocalWorkflowClaimPoller({ enabled, runtimeUrl });
}
