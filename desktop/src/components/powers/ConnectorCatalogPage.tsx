import { useState } from "react";
import { useConnectorsCatalogState } from "@/hooks/mcp/use-connectors-catalog-state";
import { useConnectOAuthConnector } from "@/hooks/mcp/use-connect-oauth-connector";
import { useConnectorSyncRetry } from "@/hooks/mcp/use-connector-sync-retry";
import { useDeleteConnector } from "@/hooks/mcp/use-delete-connector";
import { useInstallConnector } from "@/hooks/mcp/use-install-connector";
import { useInstalledConnectorActions } from "@/hooks/mcp/use-installed-connector-actions";
import { useReconnectOAuthConnector } from "@/hooks/mcp/use-reconnect-oauth-connector";
import { useUpdateConnectorSecret } from "@/hooks/mcp/use-update-connector-secret";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { Input } from "@/components/ui/Input";
import { Search } from "@/components/ui/icons";
import {
  AvailableConnectorCard,
  ConnectedConnectorCard,
} from "./ConnectorCard";
import { ConnectorDetailModal } from "./ConnectorDetailModal";
import { DeleteConnectorDialog } from "./DeleteConnectorDialog";

export function ConnectorCatalogPage() {
  const state = useConnectorsCatalogState();
  const installedActions = useInstalledConnectorActions();
  const installMutation = useInstallConnector();
  const connectOAuthMutation = useConnectOAuthConnector();
  const reconnectOAuthMutation = useReconnectOAuthConnector();
  const updateSecretMutation = useUpdateConnectorSecret();
  const deleteMutation = useDeleteConnector();
  const { retryConnectorSync } = useConnectorSyncRetry();

  const [deleteTarget, setDeleteTarget] = useState<InstalledConnectorRecord | null>(null);

  const callbacks = {
    onCancelOAuth: async () => {
      await connectOAuthMutation.cancelPendingConnection();
      await reconnectOAuthMutation.cancelPendingConnection();
    },
    onConnectOAuth: (catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"], settings?: Parameters<typeof connectOAuthMutation.mutateAsync>[0]["settings"]) =>
      connectOAuthMutation.mutateAsync({ catalogEntryId, settings }),
    onDelete: async (
      connectionId: string,
      catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"],
    ) => {
      await deleteMutation.mutateAsync({ connectionId, catalogEntryId });
      state.closeModal();
    },
    onInstallSecret: async (
      catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"],
      secretValue: string,
    ) => {
      await installMutation.mutateAsync({ catalogEntryId, secretValue });
    },
    onReconnect: (
      connectionId: string,
      catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"],
      settings?: Parameters<typeof reconnectOAuthMutation.mutateAsync>[0]["settings"],
    ) =>
      reconnectOAuthMutation.mutateAsync({
        connectionId,
        catalogEntryId,
        settings,
      }),
    onRetrySync: async (
      connectionId: string,
      catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"],
    ) => {
      const result = await retryConnectorSync.mutateAsync({
        connectionId,
        catalogEntryId,
      });
      return result.recovered;
    },
    onUpdateSecret: async (
      connectionId: string,
      catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"],
      secretValue: string,
    ) => {
      await updateSecretMutation.mutateAsync({
        connectionId,
        catalogEntryId,
        secretValue,
      });
    },
  };

  const handleDeleteConfirmed = async (
    connectionId: string,
    catalogEntryId: InstalledConnectorRecord["catalogEntry"]["id"],
  ) => {
    await deleteMutation.mutateAsync({ connectionId, catalogEntryId });
    setDeleteTarget(null);
  };

  return (
    <div className="mx-auto min-h-full w-full max-w-5xl px-6 pb-14 pt-10">
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-medium text-foreground">Powers</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Integrations Proliferate can use inside every session.
          </p>
        </div>

        <div className="sticky top-0 z-10 -mx-6 bg-background/95 px-6 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={state.searchQuery}
              onChange={(event) => state.setSearchQuery(event.target.value)}
              placeholder="Search integrations..."
              className="pl-9"
              aria-label="Search integrations"
            />
          </div>
        </div>

        {state.searchEmpty ? (
          <div className="rounded-lg border border-border bg-card/50 px-4 py-8 text-center">
            <div className="text-sm font-medium text-foreground">
              No integrations match "{state.searchQuery}"
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different search term.
            </p>
          </div>
        ) : (
          <>
            {state.connected.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-foreground">Connected</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {state.connected.map((model) => (
                    <ConnectedConnectorCard
                      key={model.record.metadata.connectionId}
                      model={model}
                      pending={installedActions.isPending(model.record.metadata.connectionId)}
                      onDelete={() => setDeleteTarget(model.record)}
                      onManage={() => state.openManage(model.record.metadata.connectionId)}
                      onReconnect={() => state.openManage(model.record.metadata.connectionId)}
                      onStatusClick={() => state.openRecovery(model.record)}
                      onToggle={(enabled) => {
                        void installedActions.onToggle(model.record, enabled);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">Available</h3>
              {state.firstRunEmpty && state.availableCards.length > 0 && (
                <div className="rounded-lg border border-border bg-card/50 px-4 py-4">
                  <div className="text-sm font-medium text-foreground">
                    No integrations configured
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Pick an integration below. Connected integrations are
                    available automatically in every session.
                  </p>
                </div>
              )}
              {state.availableCards.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {state.availableCards.map((model) => (
                    <AvailableConnectorCard
                      key={model.entry.id}
                      model={model}
                      onConnect={() => state.openConnect(model.entry.id)}
                    />
                  ))}
                </div>
              ) : (
                !state.isSearching && (
                  <p className="text-sm text-muted-foreground">
                    All available integrations are connected.
                  </p>
                )
              )}
            </section>
          </>
        )}
      </section>

      {state.modal && (
        <ConnectorDetailModal
          modal={state.modal}
          onClose={state.closeModal}
          onSetTab={state.setActiveTab}
          callbacks={callbacks}
        />
      )}

      {deleteTarget && (
        <DeleteConnectorDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={handleDeleteConfirmed}
          record={deleteTarget}
        />
      )}
    </div>
  );
}
