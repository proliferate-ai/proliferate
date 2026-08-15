import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { IntegrationIcon } from "#product/components/settings/panes/integrations/IntegrationIcon";
import type { CloudIntegrationView } from "#product/lib/domain/cloud/integrations";
import {
  integrationAuthKindLabel,
  integrationHealthBadge,
  integrationRowActions,
  integrationToolCountLabel,
} from "#product/lib/domain/settings/integrations-presentation";

interface IntegrationRowProps {
  integration: CloudIntegrationView;
  /** An OAuth handoff is waiting on the browser for this integration. */
  oauthPending: boolean;
  connecting: boolean;
  cancellingOauth: boolean;
  onConnect: (integration: CloudIntegrationView) => void;
  onCancelOauth: () => void;
  onRequestDisconnect: (integration: CloudIntegrationView) => void;
}

export function IntegrationRow({
  integration,
  oauthPending,
  connecting,
  cancellingOauth,
  onConnect,
  onCancelOauth,
  onRequestDisconnect,
}: IntegrationRowProps) {
  const badge = integrationHealthBadge(integration.health);
  const actions = integrationRowActions(integration);
  const toolCountLabel = integrationToolCountLabel(integration.toolCount);

  // Column contract (RosterRow, density="comfortable"): leading = brand tile,
  // title = displayName, secondary = the definition's description. The old
  // grid's two middle meta columns (auth kind, tool count) collapse into
  // always-visible text inside `trailing`, alongside the health badge and the
  // action button(s) — RosterRow has one always-visible trailing slot, not
  // four independently aligned columns, so the meta line and the action
  // cluster now share that slot instead of owning fixed-width columns of
  // their own. `actions` (RosterRow's hover-revealed slot) is deliberately
  // unused: Connect/Disconnect must stay visible without a hover, so they
  // live in `trailing` next to the meta text and badge.
  return (
    <RosterRow
      density="comfortable"
      leading={(
        <IntegrationIcon namespace={integration.namespace} className="icon-display [font-size:var(--text-sidebar-brand)]" />
      )}
      title={integration.displayName}
      secondary={integration.description}
      data-integration-connected={
        integration.accountId !== null && integration.health === "ready"
          ? integration.namespace
          : undefined
      }
      trailing={(
        // Layout stability: every pending state renders inline in this same
        // trailing cell, and every action button carries the same fixed
        // min-width, so Connect / Connecting... / Reconnect / Cancel swap
        // labels in place instead of resizing and bumping the badge (and
        // anything left of it) sideways. The connecting state deliberately
        // swaps the label rather than using the Button loading spinner,
        // which would widen the button. The meta line (auth kind, tool
        // count) stays outside the pending/idle split — it described the
        // integration before RosterRow, not the in-flight connect action,
        // so it keeps rendering through an OAuth handoff too.
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
            {integrationAuthKindLabel(integration.authKind)}
          </span>
          {toolCountLabel ? (
            <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
              {toolCountLabel}
            </span>
          ) : null}
          {oauthPending ? (
            <>
              <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
                Waiting for browser...
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-24"
                loading={cancellingOauth}
                onClick={onCancelOauth}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {actions.connect || actions.reconnect ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-24"
                  disabled={connecting}
                  data-integration-connect-trigger={integration.namespace}
                  onClick={() => onConnect(integration)}
                >
                  {connecting
                    ? "Connecting..."
                    : actions.connect
                      ? "Connect"
                      : "Reconnect"}
                </Button>
              ) : null}
              {actions.disconnect ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-24"
                  disabled={connecting}
                  onClick={() => onRequestDisconnect(integration)}
                >
                  Disconnect
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
    />
  );
}
