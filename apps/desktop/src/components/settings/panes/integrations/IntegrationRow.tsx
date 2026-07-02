import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";
import type { CloudIntegrationView } from "@/lib/domain/cloud/integrations";
import {
  integrationAuthKindLabel,
  integrationHealthBadge,
  integrationRowActions,
  integrationToolCountLabel,
} from "@/lib/domain/settings/integrations-presentation";

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

  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,14rem)] items-center gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <IntegrationIcon namespace={integration.namespace} className="size-8" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {integration.displayName}
          </div>
          {integration.description ? (
            <div className="mt-0.5 truncate text-sm text-muted-foreground">
              {integration.description}
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {integrationAuthKindLabel(integration.authKind)}
      </div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {toolCountLabel}
      </div>
      {/*
        Layout stability: every pending state renders inline in this same
        right-aligned cell, and every action button carries the same fixed
        min-width, so Connect / Connecting... / Reconnect / Cancel swap labels
        in place instead of resizing and bumping the badge (and anything left
        of it) sideways. The connecting state deliberately swaps the label
        rather than using the Button loading spinner, which would widen the
        button.
      */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {oauthPending ? (
          <>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
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
    </div>
  );
}
