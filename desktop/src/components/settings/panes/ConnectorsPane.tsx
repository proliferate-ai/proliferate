import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { AvailableConnectorRow, InstalledConnectorRow } from "@/components/settings/connectors/ConnectorRows";
import { InstallConnectorModal } from "@/components/settings/connectors/InstallConnectorModal";
import { ManageConnectorModal } from "@/components/settings/connectors/ManageConnectorModal";
import { useConnectOAuthConnector } from "@/hooks/mcp/use-connect-oauth-connector";
import { useDeleteConnector } from "@/hooks/mcp/use-delete-connector";
import { useInstalledConnectorActions } from "@/hooks/mcp/use-installed-connector-actions";
import { useInstallConnector } from "@/hooks/mcp/use-install-connector";
import { useConnectorsPaneState } from "@/hooks/mcp/use-connectors-pane-state";
import { useReconnectOAuthConnector } from "@/hooks/mcp/use-reconnect-oauth-connector";
import { useConnectorSyncRetry } from "@/hooks/mcp/use-connector-sync-retry";
import { useUpdateConnectorSecret } from "@/hooks/mcp/use-update-connector-secret";

export function ConnectorsPane() {
  const state = useConnectorsPaneState();
  const connectOAuthMutation = useConnectOAuthConnector();
  const installMutation = useInstallConnector();
  const reconnectOAuthMutation = useReconnectOAuthConnector();
  const updateSecretMutation = useUpdateConnectorSecret();
  const deleteMutation = useDeleteConnector();
  const { retryConnectorSync } = useConnectorSyncRetry();
  const installedActions = useInstalledConnectorActions();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Connectors"
        description="Services Proliferate can use in every session."
      />

      {state.installed.length === 0 && (
        <div className="rounded-lg border border-border bg-card/50 px-4 py-4">
          <div className="text-sm font-medium text-foreground">Connect a service to get started</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a connector below. Connected services are available automatically in every session.
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
          <p className="text-sm text-muted-foreground">All available connectors are connected.</p>
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
  );
}
