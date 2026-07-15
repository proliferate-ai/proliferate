import type {
  DesktopBridge,
  DesktopNativeUiBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { useExportRunningAgentCount } from "#product/hooks/app/lifecycle/use-export-running-agent-count";
import { useDesktopRuntimeBootstrapLifecycle } from "#product/hooks/app/lifecycle/use-desktop-runtime-bootstrap-lifecycle";
import { useUpdateRestartWatcher } from "#product/hooks/access/tauri/use-update-restart-watcher";
import { useDesktopWorkerEnrollment } from "#product/hooks/cloud/lifecycle/use-desktop-worker-enrollment";
import { useWorkspaceActivityIndicator } from "#product/hooks/app/lifecycle/use-workspace-activity-indicator";
import { useDesktopZoomPreferenceLifecycle } from "#product/hooks/preferences/lifecycle/use-desktop-zoom-preference-lifecycle";
import { useNativeMenuCommandDispatcher } from "#product/hooks/shortcuts/lifecycle/use-native-menu-command-dispatcher";
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port";

/**
 * The single Desktop product-lifecycle root, mounted outside auth and route
 * gates. It reads the Desktop bridge from the host and, when present, mounts
 * local-runtime, updater, worker-enrollment, and native-UI lifecycles through
 * that bridge. On a non-Desktop host (`desktop === null`) it renders nothing.
 */
export function DesktopProductLifecycleRoot() {
  const { auth, desktop } = useProductHost();
  const authState = auth.state;
  const authUserId =
    authState.status === "authenticated" ? (authState.user?.id ?? null) : null;
  return desktop === null
    ? null
    : (
      <DesktopProductLifecycles
        desktop={desktop}
        authStatus={authState.status}
        authUserId={authUserId}
      />
    );
}

// Nested so hook membership stays valid if `desktop` flips between a bridge and
// null across a host replacement.
function DesktopProductLifecycles({
  desktop,
  authStatus,
  authUserId,
}: {
  desktop: DesktopBridge;
  authStatus: "loading" | "anonymous" | "authenticated";
  authUserId: string | null;
}) {
  useDesktopRuntimeBootstrapLifecycle(
    desktop.runtime,
    desktop.diagnostics,
    authStatus,
  );
  useUpdateRestartWatcher(desktop.updater);
  useDesktopWorkerEnrollment(desktop.worker, authStatus, authUserId);
  const nativeUi: DesktopNativeUiBridge = desktop.nativeUi;
  useExportRunningAgentCount(nativeUi.setRunningAgentCount);
  useNativeMenuCommandDispatcher(nativeUi.subscribeMenuCommands);
  recordBootDiagnosticOnce("app_runtime.render.before.use_workspace_activity_indicator");
  useWorkspaceActivityIndicator(nativeUi.setWorkspaceActivity);
  recordBootDiagnosticOnce("app_runtime.render.after.use_workspace_activity_indicator");
  useDesktopZoomPreferenceLifecycle(nativeUi.setZoom);
  return null;
}
