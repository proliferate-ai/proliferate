import { useMemo } from "react";
import { useControlPlaneHealth } from "@/hooks/access/cloud/use-control-plane-health";
import { CLOUD_COMPUTE_TEMPORARILY_DISABLED } from "@/lib/domain/capabilities/cloud-compute";

export function useAppCapabilities() {
  const { data: reachable = false } = useControlPlaneHealth();

  return useMemo(() => ({
    cloudEnabled: reachable,
    billingEnabled: reachable,
    // Cloud compute (workspaces, remote access, mobility) is temporarily
    // disabled for this release; identity and billing stay available.
    cloudComputeEnabled: reachable && !CLOUD_COMPUTE_TEMPORARILY_DISABLED,
  }), [reachable]);
}
