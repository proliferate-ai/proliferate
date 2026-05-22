import { useConnectorCatalogActions } from "@/hooks/mcp/workflows/use-connector-catalog-actions";
import { useConnectorsCatalogState } from "@/hooks/mcp/ui/use-connectors-catalog-state";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Globe, Search } from "@/components/ui/icons";
import {
  AvailablePluginPackageRow,
  ConnectedPluginPackageRow,
} from "./PluginPackageRow";
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
  const showNoAvailablePlugins =
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
              placeholder="Search plugins..."
              className="pl-9"
              aria-label="Search plugins"
            />
          </div>
        </div>

        {showLoadingState ? (
          <LoadingState
            message="Loading plugins"
            subtext="Fetching package availability and connection state."
          />
        ) : showLoadError ? (
          <div className="rounded-lg border border-border bg-surface-elevated-secondary px-4 py-8 text-center">
            <div className="text-sm font-medium text-foreground">
              Couldn&apos;t load plugins
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
          <div className="rounded-lg border border-border bg-surface-elevated-secondary px-4 py-8 text-center">
            <div className="text-sm font-medium text-foreground">
              No plugins match "{state.searchQuery}"
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different search term.
            </p>
          </div>
        ) : (
          <>
            <SharedCloudExposureNotice
              activeOrganizationName={state.sharedExposure.activeOrganizationName}
              canManage={state.sharedExposure.canManage}
              hasOrganization={state.sharedExposure.hasOrganization}
              isLoading={state.sharedExposure.isLoading}
            />

            {state.connected.length > 0 && (
              <section className="space-y-4">
                <div className="border-b border-border/60 pb-2">
                  <h3 className="text-lg leading-6 text-foreground">Installed</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {state.connected.map((model) => (
                    <ConnectedPluginPackageRow
                      key={model.record.metadata.connectionId}
                      model={model}
                      pending={actions.installedConnectorActions.isPending(
                        model.record.metadata.connectionId,
                      )}
                      canManageSharedExposure={
                        state.sharedExposure.canManage
                        || canManageOwnSharedExposure(
                          model.record.metadata.ownerScope,
                          model.record.metadata.ownerUserId,
                          state.sharedExposure.currentUserId,
                        )
                      }
                      organizationId={state.sharedExposure.activeOrganizationId}
                      onDelete={() => actions.requestDelete(model.record)}
                      onManage={() => state.openManage(model.record.metadata.connectionId)}
                      onReconnect={() => state.openManage(model.record.metadata.connectionId)}
                      onSetSharedExposure={(publicToOrg) => {
                        if (!state.sharedExposure.activeOrganizationId) {
                          return;
                        }
                        void actions.installedConnectorActions.onSetSharedExposure(
                          model.record,
                          state.sharedExposure.activeOrganizationId,
                          publicToOrg,
                        );
                      }}
                      onStatusClick={() => state.openRecovery(model.record)}
                      onToggle={(enabled) => {
                        void actions.installedConnectorActions.onToggle(model.record, enabled);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-4">
              <div className="border-b border-border/60 pb-2">
                <h3 className="text-lg leading-6 text-foreground">Available</h3>
              </div>
              {state.firstRunEmpty && state.availableCards.length > 0 && (
                <div className="rounded-2xl border border-border/40 bg-foreground/5 px-4 py-3">
                  <div className="text-sm font-medium text-foreground">
                    No plugins installed
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Install a package below. Enabled packages add MCP tools and
                    plugin skills to managed cloud sandbox runtime config.
                  </p>
                </div>
              )}
              {state.availableCards.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {state.availableCards.map((model) => (
                    <AvailablePluginPackageRow
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
                      ? "All available plugins are installed."
                      : showNoAvailablePlugins
                        ? "No plugins are available right now."
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

function canManageOwnSharedExposure(
  ownerScope: string,
  ownerUserId: string | null | undefined,
  currentUserId: string | null,
): boolean {
  return ownerScope !== "organization"
    && Boolean(currentUserId)
    && ownerUserId === currentUserId;
}

function SharedCloudExposureNotice({
  activeOrganizationName,
  canManage,
  hasOrganization,
  isLoading,
}: {
  activeOrganizationName: string | null;
  canManage: boolean;
  hasOrganization: boolean;
  isLoading: boolean;
}) {
  const title = canManage
    ? `Shared cloud access${activeOrganizationName ? ` for ${activeOrganizationName}` : ""}`
    : "Shared cloud access";
  const description = !hasOrganization
    ? "Join an organization before making MCPs, plugins, and skills available to shared cloud."
    : canManage
      ? "Make installed MCP, plugin, and skill items public here. Public items can be used by team automations, Slack, and shared cloud work; shared environments inherit this sandbox-wide set."
      : "Installed items show whether they are private or public. Organization owners and admins can make them public for team automations, Slack, and shared cloud work.";

  return (
    <div className="rounded-lg border border-border/60 bg-surface-elevated-secondary px-4 py-3">
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/20 text-muted-foreground"
        >
          <Globe className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {isLoading ? "Checking shared cloud access" : title}
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
