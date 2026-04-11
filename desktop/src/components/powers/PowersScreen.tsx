import { AvailableConnectorRow, InstalledConnectorRow } from "@/components/settings/connectors/ConnectorRows";
import { InstallConnectorModal } from "@/components/settings/connectors/InstallConnectorModal";
import { ManageConnectorModal } from "@/components/settings/connectors/ManageConnectorModal";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { MainSidebar } from "@/components/workspace/shell/sidebar/MainSidebar";
import { SidebarUpdatePill } from "@/components/workspace/shell/SidebarUpdatePill";
import { IconButton } from "@/components/ui/IconButton";
import { SplitPanel } from "@/components/ui/icons";
import { useConnectOAuthConnector } from "@/hooks/mcp/use-connect-oauth-connector";
import { useConnectorsPaneState } from "@/hooks/mcp/use-connectors-pane-state";
import { useConnectorSyncRetry } from "@/hooks/mcp/use-connector-sync-retry";
import { useDeleteConnector } from "@/hooks/mcp/use-delete-connector";
import { useInstallConnector } from "@/hooks/mcp/use-install-connector";
import { useInstalledConnectorActions } from "@/hooks/mcp/use-installed-connector-actions";
import { useReconnectOAuthConnector } from "@/hooks/mcp/use-reconnect-oauth-connector";
import { useUpdateConnectorSecret } from "@/hooks/mcp/use-update-connector-secret";
import { useResize } from "@/hooks/layout/use-resize";
import { useUpdater } from "@/hooks/updater/use-updater";
import {
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";

export function PowersScreen() {
  const sidebarOpen = useWorkspaceUiStore((s) => s.sidebarOpen);
  const sidebarWidth = useWorkspaceUiStore((s) => s.sidebarWidth);
  const setSidebarOpen = useWorkspaceUiStore((s) => s.setSidebarOpen);
  const setSidebarWidth = useWorkspaceUiStore((s) => s.setSidebarWidth);
  const state = useConnectorsPaneState();
  const connectOAuthMutation = useConnectOAuthConnector();
  const installMutation = useInstallConnector();
  const reconnectOAuthMutation = useReconnectOAuthConnector();
  const updateSecretMutation = useUpdateConnectorSecret();
  const deleteMutation = useDeleteConnector();
  const { retryConnectorSync } = useConnectorSyncRetry();
  const installedActions = useInstalledConnectorActions();
  const {
    phase: updaterPhase,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();

  const onLeftSeparatorDown = useResize({
    direction: "horizontal",
    size: sidebarWidth,
    onResize: setSidebarWidth,
    min: WORKSPACE_SIDEBAR_MIN_WIDTH,
    max: WORKSPACE_SIDEBAR_MAX_WIDTH,
  });

  return (
    <div className="h-screen flex overflow-hidden bg-sidebar" data-telemetry-block>
      <div
        id="main-sidebar"
        className="flex shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-in-out"
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
          <div className="flex h-full items-center gap-2 pl-[82px]">
            <IconButton
              tone="sidebar"
              size="sm"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              className="rounded-md"
            >
              <SplitPanel className="size-4" />
            </IconButton>
            <SidebarUpdatePill
              phase={updaterPhase}
              onDownloadUpdate={downloadUpdate}
              onOpenRestartPrompt={openRestartPrompt}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <MainSidebar />
        </div>
      </div>

      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-controls="main-sidebar"
          onMouseDown={onLeftSeparatorDown}
          className="relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center -ml-1 hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      )}

      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-background ${sidebarOpen ? "rounded-tl-lg" : ""}`}>
        <div className="flex h-10 shrink-0 items-center" data-tauri-drag-region="true">
          {!sidebarOpen && (
            <div className="flex items-center gap-2 pl-[82px] pr-2">
              <IconButton
                size="sm"
                onClick={() => setSidebarOpen(true)}
                title="Show sidebar"
                className="rounded-md"
              >
                <SplitPanel className="size-4" />
              </IconButton>
              <SidebarUpdatePill
                phase={updaterPhase}
                onDownloadUpdate={downloadUpdate}
                onOpenRestartPrompt={openRestartPrompt}
              />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 bg-background h-full relative overflow-auto">
            <div className="absolute inset-x-0 top-0 h-10" data-tauri-drag-region="true" />

            <div className="mx-auto min-h-full w-full max-w-2xl px-6 pb-16 pt-16">
              <section className="space-y-6">
                <div>
                  <h2 className="text-2xl font-medium text-foreground">Powers</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Services Proliferate can use in every session.
                  </p>
                </div>

                {state.installed.length === 0 && (
                  <div className="rounded-lg border border-border bg-card/50 px-4 py-4">
                    <div className="text-sm font-medium text-foreground">
                      Connect a service to get started
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose a power below. Connected services are available automatically
                      in every session.
                    </p>
                  </div>
                )}

                {state.installed.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-foreground">Installed</h3>
                    <SettingsCard>
                      {state.installed.map((record, index) => (
                        <InstalledConnectorRow
                          key={record.metadata.connectionId}
                          isFirst={index === 0}
                          isPending={installedActions.isPending(record.metadata.connectionId)}
                          onManage={() => state.openManageModal(record.metadata.connectionId)}
                          onRetry={() => { void installedActions.onRetry(record); }}
                          onToggle={(enabled) => { void installedActions.onToggle(record, enabled); }}
                          record={record}
                        />
                      ))}
                    </SettingsCard>
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">Available</h3>
                  {state.available.length > 0 ? (
                    <SettingsCard>
                      {state.available.map((entry, index) => (
                        <AvailableConnectorRow
                          key={entry.id}
                          entry={entry}
                          isFirst={index === 0}
                          onConnect={() => state.openInstallModal(entry.id)}
                        />
                      ))}
                    </SettingsCard>
                  ) : (
                    <p className="text-sm text-muted-foreground">All available powers are connected.</p>
                  )}
                </div>

                <InstallConnectorModal
                  entry={state.installTarget}
                  onClose={state.closeModal}
                  onCancelOAuth={async () => {
                    await connectOAuthMutation.cancelPendingConnection();
                  }}
                  onConnectOAuth={async (catalogEntryId, settings) => {
                    return connectOAuthMutation.mutateAsync({ catalogEntryId, settings });
                  }}
                  onInstallSecret={async (catalogEntryId, secretValue) => {
                    await installMutation.mutateAsync({ catalogEntryId, secretValue });
                  }}
                />

                <ManageConnectorModal
                  record={state.manageTarget}
                  onClose={state.closeModal}
                  onDelete={async (connectionId, catalogEntryId) => {
                    await deleteMutation.mutateAsync({ connectionId, catalogEntryId });
                    state.closeModal();
                  }}
                  onCancelOAuth={async () => {
                    await reconnectOAuthMutation.cancelPendingConnection();
                  }}
                  onRetry={async (connectionId, catalogEntryId) => {
                    const result = await retryConnectorSync.mutateAsync({ connectionId, catalogEntryId });
                    return result.recovered;
                  }}
                  onReconnect={async (connectionId, catalogEntryId, settings) => {
                    return reconnectOAuthMutation.mutateAsync({
                      connectionId,
                      catalogEntryId,
                      settings,
                    });
                  }}
                  onSaveSecret={async (connectionId, catalogEntryId, secretValue) => {
                    await updateSecretMutation.mutateAsync({ connectionId, catalogEntryId, secretValue });
                  }}
                />
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
