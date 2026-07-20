import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { ArrowUpRight, Blocks, Settings } from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { IntegrationIcon } from "#product/components/settings/panes/integrations/IntegrationIcon";
import { useComposerIntegrationsState } from "#product/hooks/cloud/derived/use-composer-integrations-state";
import {
  composerIntegrationHealthDot,
  type ComposerIntegrationProvider,
} from "#product/lib/domain/cloud/composer-integrations";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";
import {
  StatusRow,
  StatusSection,
} from "#product/components/workspace/chat/input/workspace-status/StatusCardPrimitives";

/**
 * The single composer integrations control. Always present: an icon-only plug
 * when nothing is connected, a quiet plug + count when every connected
 * integration is healthy, and the old reauth chip's urgent warning
 * presentation the moment one needs re-authentication. Clicking opens a
 * status-card-anatomy popover listing the connected providers, each with a
 * health dot and — when it needs re-authentication — a Reconnect affordance
 * that deep-links to Settings.
 */
export function ComposerIntegrationsControl() {
  const navigate = useNavigate();
  const { mode, connectedCount, providers, reauthLabel } = useComposerIntegrationsState();

  const goToIntegrations = () =>
    navigate(buildSettingsHref({ section: "integrations" }));

  const isUrgent = mode === "urgent" && reauthLabel !== null;
  const triggerLabel = isUrgent
    ? reauthLabel
    : connectedCount > 0
      ? String(connectedCount)
      : "Integrations";
  const triggerAriaLabel = isUrgent
    ? `${reauthLabel}. Open connected integrations.`
    : `${connectedCount} connected ${connectedCount === 1 ? "integration" : "integrations"}. Open connected integrations.`;

  return (
    <PopoverButton
      align="end"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
      trigger={(
        <ComposerControlButton
          iconOnly={connectedCount === 0 && !isUrgent}
          label={triggerLabel}
          aria-label={triggerAriaLabel}
          icon={
            isUrgent ? (
              <span
                aria-hidden="true"
                className="block icon-status rounded-full bg-warning/70"
              />
            ) : (
              <Blocks aria-hidden="true" className="icon-control" />
            )
          }
        />
      )}
    >
      {(close) => (
        // Same card surface + section/row anatomy as the workspace-status
        // card, so every composer popover speaks one UI language.
        <ComposerPopoverSurface
          variant="summary"
          className="w-[min(300px,calc(100vw-1rem))] overflow-hidden rounded-[1.25rem] p-0 pt-2.5 ring-0 shadow-[0_0_0_0.5px_var(--color-popover-ring),0_3px_7.5px_rgba(0,0,0,0.25),0_0_20px_rgba(0,0,0,0.28)]"
        >
          <div className="flex max-h-[min(34rem,calc(100vh-8rem))] flex-col gap-3 overflow-y-auto pb-3">
            <StatusSection
              title="Integrations"
              detail={connectedCount > 0 ? `${connectedCount} connected` : null}
            >
              {providers.length === 0 && (
                <StatusRow
                  icon={<Blocks className="icon-paired" />}
                  label="No integrations connected"
                  disabled
                />
              )}
              {providers.map((provider) => (
                <ProviderRow
                  key={provider.definitionId}
                  provider={provider}
                  onReconnect={() => {
                    goToIntegrations();
                    close();
                  }}
                />
              ))}
              <StatusRow
                icon={<Settings className="icon-paired" />}
                label="Manage integrations"
                trailing={(
                  <span className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/status-row:opacity-100 group-focus-visible/status-row:opacity-100">
                    <ArrowUpRight className="icon-paired" />
                  </span>
                )}
                onSelect={() => {
                  goToIntegrations();
                  close();
                }}
              />
            </StatusSection>
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

/** One provider in the shared status-row recipe: provider icon in the fixed
 * slot, name, health dot trailing — with the Reconnect action styled like the
 * status card's checks-row "View" action when re-auth is needed. */
function ProviderRow({
  provider,
  onReconnect,
}: {
  provider: ComposerIntegrationProvider;
  onReconnect: () => void;
}) {
  const dot = composerIntegrationHealthDot(provider.health);

  return (
    <StatusRow
      icon={<IntegrationIcon namespace={provider.namespace} className="icon-paired rounded-sm [font-size:var(--text-composer)]" />}
      label={provider.displayName}
      trailing={(
        <span className="flex shrink-0 items-center gap-2">
          {provider.needsReauth && (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={onReconnect}
              className="shrink-0 rounded-sm px-1 text-ui text-warning-foreground hover:text-foreground"
            >
              Reconnect
            </Button>
          )}
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${dot.className}`}
          />
          <span className="sr-only">{dot.label}</span>
        </span>
      )}
    />
  );
}
