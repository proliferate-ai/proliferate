import { useMemo } from "react";
import { isOfficialHostedApiBaseUrl } from "@/lib/infra/proliferate-api";
import { useControlPlaneHealth } from "@/hooks/cloud/use-control-plane-health";

export function useAppCapabilities() {
  const { data: reachable = false } = useControlPlaneHealth();
  const isOfficialHosted = isOfficialHostedApiBaseUrl();

  return useMemo(() => ({
    cloudEnabled: reachable,
    supportEnabled: reachable && isOfficialHosted,
    billingEnabled: reachable && isOfficialHosted,
  }), [isOfficialHosted, reachable]);
}
