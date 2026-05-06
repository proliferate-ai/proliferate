import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useLocalAutomationClaimPoller } from "./use-local-automation-claim-poller";

export function useLocalAutomationExecutor(): void {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const { cloudActive } = useCloudAvailabilityState();
  const enabled =
    cloudActive
    && connectionState === "healthy"
    && runtimeUrl.trim().length > 0;

  useLocalAutomationClaimPoller({
    enabled,
    runtimeUrl,
  });
}
