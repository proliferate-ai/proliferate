import type {
  DesktopBridge,
  DesktopNativeUiBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { AuthState } from "@proliferate/product-client/host/product-host";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";

import { useExportRunningAgentCount } from "@/hooks/app/lifecycle/use-export-running-agent-count";
import { useDebugSessionActivity } from "@/hooks/app/lifecycle/use-debug-session-activity";
import { useDesktopRuntimeBootstrapLifecycle } from "@/hooks/app/lifecycle/use-desktop-runtime-bootstrap-lifecycle";
import { useUpdateRestartWatcher } from "@/hooks/access/tauri/use-update-restart-watcher";
import { useDesktopWorkerEnrollment } from "@/hooks/cloud/lifecycle/use-desktop-worker-enrollment";
import { useWorkspaceActivityIndicator } from "@/hooks/app/lifecycle/use-workspace-activity-indicator";
import { useDesktopZoomPreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-desktop-zoom-preference-lifecycle";
import { useNativeMenuCommandDispatcher } from "@/hooks/shortcuts/lifecycle/use-native-menu-command-dispatcher";
import { useAgentAutoReconcile } from "@/hooks/agents/lifecycle/use-agent-auto-reconcile";
import { useFirstRunAuthAdoption } from "@/hooks/agents/lifecycle/use-first-run-auth-adoption";
import { useGatewayCatalogMirrorSync } from "@/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync";
import { useLocalAuthStateSync } from "@/hooks/agents/lifecycle/use-local-auth-state-sync";
import { useLocalAutomationExecutor } from "@/hooks/automations/lifecycle/use-local-automation-executor";
import { useLocalWorktreeSettingsTarget } from "@/hooks/workspaces/facade/use-local-worktree-settings-target";
import { useWorktreeCleanupPolicySync } from "@/hooks/workspaces/lifecycle/use-worktree-cleanup-policy-sync";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { MacWindowControlsSafeArea } from "@/components/app/chrome/MacWindowControlsSafeArea";
import { UpdateRestartDialog } from "@/components/feedback/UpdateRestartDialog";
import { UpdateToastPresenter } from "@/components/feedback/UpdateToastPresenter";

/**
 * The single Desktop product-lifecycle root, mounted outside auth and route
 * gates. It reads the Desktop bridge from the host and, when present, mounts
 * local-runtime, updater, worker-enrollment, and native-UI lifecycles through
 * that bridge. On a non-Desktop host (`desktop === null`) it renders nothing.
 */
export function DesktopProductLifecycleRoot() {
  const { auth, cloud, desktop } = useProductHost();
  return desktop === null
    ? null
    : (
      <DesktopProductLifecycles
        desktop={desktop}
        authState={auth.state}
        cloudClient={cloud.client}
      />
    );
}

// Nested so hook membership stays valid if `desktop` flips between a bridge and
// null across a host replacement.
function DesktopProductLifecycles({
  desktop,
  authState,
  cloudClient,
}: {
  desktop: DesktopBridge;
  authState: AuthState;
  cloudClient: ProliferateCloudClient | null;
}) {
  useDebugSessionActivity(desktop.diagnostics);
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.before.use_agent_auto_reconcile",
  });
  useAgentAutoReconcile();
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.after.use_agent_auto_reconcile",
  });
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.before.use_first_run_auth_adoption",
  });
  useFirstRunAuthAdoption();
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.after.use_first_run_auth_adoption",
  });
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.before.use_local_auth_state_sync",
  });
  useLocalAuthStateSync();
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.after.use_local_auth_state_sync",
  });
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.before.use_gateway_catalog_mirror_sync",
  });
  useGatewayCatalogMirrorSync();
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.after.use_gateway_catalog_mirror_sync",
  });
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.before.use_local_automation_executor",
  });
  useLocalAutomationExecutor();
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.after.use_local_automation_executor",
  });
  useDesktopRuntimeBootstrapLifecycle(
    desktop.runtime,
    desktop.diagnostics,
    authState.status,
  );
  useUpdateRestartWatcher(desktop.updater);
  useDesktopWorkerEnrollment(desktop.worker, authState, cloudClient);
  const nativeUi: DesktopNativeUiBridge = desktop.nativeUi;
  useExportRunningAgentCount(nativeUi.setRunningAgentCount);
  useNativeMenuCommandDispatcher(nativeUi.subscribeMenuCommands);
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.before.use_workspace_activity_indicator",
  });
  useWorkspaceActivityIndicator(nativeUi.setWorkspaceActivity);
  desktop.diagnostics.recordBootEventOnce({
    label: "app_runtime.render.after.use_workspace_activity_indicator",
  });
  useDesktopZoomPreferenceLifecycle(nativeUi.setZoom);
  return (
    <>
      <MacWindowControlsSafeArea />
      <UpdateRestartDialog />
      <UpdateToastPresenter />
      <WorktreeCleanupPolicySyncGate />
    </>
  );
}

function WorktreeCleanupPolicySyncGate() {
  const preferencesHydrated = useUserPreferencesStore((state) => state._hydrated);
  return preferencesHydrated ? <WorktreeCleanupPolicySyncMount /> : null;
}

function WorktreeCleanupPolicySyncMount() {
  const settings = useLocalWorktreeSettingsTarget();
  useWorktreeCleanupPolicySync(settings.targets, settings.syncPolicyToTarget);
  return null;
}
