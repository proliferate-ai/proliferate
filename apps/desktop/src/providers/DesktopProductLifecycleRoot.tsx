import type {
  DesktopBridge,
  DesktopNativeUiBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useExportRunningAgentCount } from "@/hooks/app/lifecycle/use-export-running-agent-count";
import { useWorkspaceActivityIndicator } from "@/hooks/app/lifecycle/use-workspace-activity-indicator";
import { useDesktopZoomPreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-desktop-zoom-preference-lifecycle";
import { useNativeMenuCommandDispatcher } from "@/hooks/shortcuts/lifecycle/use-native-menu-command-dispatcher";
import { recordBootDiagnosticOnce } from "@/lib/infra/measurement/boot-stall-diagnostics";

/**
 * The single Desktop product-lifecycle root, mounted outside auth and route
 * gates. It reads the Desktop bridge from the host and, when present, mounts
 * the native UI lifecycles through `desktop.nativeUi`. On a non-Desktop host
 * (`desktop === null`) it renders nothing.
 */
export function DesktopProductLifecycleRoot() {
  const { desktop } = useProductHost();
  return desktop === null ? null : <DesktopNativeUiLifecycles desktop={desktop} />;
}

// Nested so hook membership stays valid if `desktop` flips between a bridge and
// null across a host replacement.
function DesktopNativeUiLifecycles({ desktop }: { desktop: DesktopBridge }) {
  const nativeUi: DesktopNativeUiBridge = desktop.nativeUi;
  useExportRunningAgentCount(nativeUi.setRunningAgentCount);
  useNativeMenuCommandDispatcher(nativeUi.subscribeMenuCommands);
  recordBootDiagnosticOnce("app_runtime.render.before.use_workspace_activity_indicator");
  useWorkspaceActivityIndicator(nativeUi.setWorkspaceActivity);
  recordBootDiagnosticOnce("app_runtime.render.after.use_workspace_activity_indicator");
  useDesktopZoomPreferenceLifecycle(nativeUi.setZoom);
  return null;
}
