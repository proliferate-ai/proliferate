import { useMemo } from "react";
import { useControlPlaneHealth } from "@/hooks/access/cloud/use-control-plane-health";

export function useAppCapabilities() {
  const { data: reachable = false } = useControlPlaneHealth();

  return useMemo(() => ({
    cloudEnabled: reachable,
    billingEnabled: reachable,
  }), [reachable]);
}
