import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLocalAutomationClaimPoller } from "./use-local-automation-claim-poller";

export function useLocalAutomationExecutor(): void {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
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
