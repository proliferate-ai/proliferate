import type { DesktopBridge } from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useExportRunningAgentCount } from "@/hooks/app/lifecycle/use-export-running-agent-count";

/**
 * The single Desktop product-lifecycle root, mounted outside auth and route
 * gates. It reads the Desktop bridge from the host and, when present, mounts
 * the running-agent count export through `desktop.nativeUi.setRunningAgentCount`.
 * On a non-Desktop host (`desktop === null`) it renders nothing.
 */
export function DesktopProductLifecycleRoot() {
  const { desktop } = useProductHost();
  return desktop === null ? null : <RunningAgentCountLifecycle desktop={desktop} />;
}

// Nested so hook membership stays valid if `desktop` flips between a bridge and
// null across a host replacement.
function RunningAgentCountLifecycle({ desktop }: { desktop: DesktopBridge }) {
  useExportRunningAgentCount(desktop.nativeUi.setRunningAgentCount);
  return null;
}
