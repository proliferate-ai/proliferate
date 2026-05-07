import { useConnectorCatalogActions } from "@/hooks/mcp/use-connector-catalog-actions";
import { useConnectorsCatalogState } from "@/hooks/mcp/use-connectors-catalog-state";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Search } from "@/components/ui/icons";
import {
  AvailableConnectorCard,
  ConnectedConnectorCard,
} from "./ConnectorCard";
import { ConnectorDetailModal } from "@/components/plugins/detail/ConnectorDetailModal";
import { DeleteConnectorDialog } from "@/components/plugins/detail/DeleteConnectorDialog";

export function ConnectorCatalogPage() {
  const state = useConnectorsCatalogState();
  const actions = useConnectorCatalogActions({ closeModal: state.closeModal });

  const showLoadingState = state.isLoading
    && state.connected.length === 0
    && state.availableCards.length === 0;
  const showLoadError = !!state.loadError
    && state.connected.length === 0
    && state.availableCards.length === 0;
  const showAllConnected = state.connected.length > 0 && state.availableCards.length === 0;
  const showNoAvailableIntegrations =
    state.connected.length === 0 && state.availableCards.length === 0;

  return (
    <>
      <section className="space-y-6">
        <div className="sticky top-10 z-10 -mx-6 bg-background/95 px-6 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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

        {showLoadingState ? (
          <LoadingState
            message="Loading integrations"
            subtext="Fetching the latest Plugins catalog and connection state."
          />
        ) : showLoadError ? (
          <div className="rounded-lg border border-border bg-card/50 px-4 py-8 text-center">
            <div className="text-sm font-medium text-foreground">
              Couldn&apos;t load integrations
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {state.loadError}
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => state.retryLoad()}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : state.searchEmpty ? (
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
                      pending={actions.installedConnectorActions.isPending(
                        model.record.metadata.connectionId,
                      )}
                      onDelete={() => actions.requestDelete(model.record)}
                      onManage={() => state.openManage(model.record.metadata.connectionId)}
                      onReconnect={() => state.openManage(model.record.metadata.connectionId)}
                      onStatusClick={() => state.openRecovery(model.record)}
                      onToggle={(enabled) => {
                        void actions.installedConnectorActions.onToggle(model.record, enabled);
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
                    available to new sessions when plugins are enabled for that
                    session type.
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
                    {showAllConnected
                      ? "All available integrations are connected."
                      : showNoAvailableIntegrations
                        ? "No integrations are available right now."
                        : null}
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
          callbacks={actions.detailCallbacks}
        />
      )}

      {actions.deleteTarget && (
        <DeleteConnectorDialog
          open={!!actions.deleteTarget}
          onClose={actions.closeDeleteDialog}
          onDelete={actions.confirmDelete}
          record={actions.deleteTarget}
        />
      )}
    </>
  );
}
