import { useNavigate } from "react-router-dom";
import { Button } from "#product/primitives/Button";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import { PopoverButton } from "#product/primitives/PopoverButton";
import { ArrowUpRight, Settings } from "#product/primitives/icons/core";
import { Globe } from "#product/primitives/icons/platform";
import { ComposerPopoverSurface } from "#product/components/workspace/chat/composer/ComposerPopoverSurface";
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
 * The composer integrations control — urgent states only. A healthy
 * integration is not news, so connected/quiet renders nothing at all and the
 * control row keeps one fewer permanent resident; the chip appears only when a
 * provider needs re-authentication, which is the one state the composer can
 * act on. Clicking opens the unchanged status-card-anatomy popover listing the
 * connected providers, each with a health dot and — when it needs
 * re-authentication — a Reconnect affordance that deep-links to Settings.
 */
export function ComposerIntegrationsControl() {
  const navigate = useNavigate();
  const { mode, connectedCount, providers, reauthLabel } = useComposerIntegrationsState();

  const goToIntegrations = () =>
    navigate(buildSettingsHref({ section: "integrations" }));

  if (mode !== "urgent" || reauthLabel === null) {
    return null;
  }

  const triggerAriaLabel = `${reauthLabel}. Open connected integrations.`;
  // Same helper the popover rows call, so trigger and rows cannot drift: on the
  // composer surface `needs_reauth` resolves to the neutral foreground dot.
  const triggerDot = composerIntegrationHealthDot("needs_reauth", { surface: "composer" });

  return (
    <PopoverButton
      align="end"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
      trigger={(
        <ComposerControlButton
          size="compact"
          label={reauthLabel}
          // The urgent label stays visible (and shrinkable) at every width —
          // a warning reduced to a dot is no warning. `active` is the atom's own
          // way to say "this control reads at full ink", rather than a
          // text-color override reaching past its vocabulary.
          active
          aria-label={triggerAriaLabel}
          icon={(
            // Neutral emphasis, not a hue: the yellow --color-warning dot this
            // replaced is banned in the composer, and the composer's only
            // colored signal is the pressure ring's destructive arc. OPEN TOKEN
            // DECISION (handoff): whether re-auth eventually earns a
            // destructive tone or stays foreground-neutral is unresolved.
            <span
              aria-hidden="true"
              className={`block icon-status rounded-full ${triggerDot.className}`}
            />
          )}
        />
      )}
    >
      {(close) => (
        // Same card surface + section/row anatomy as the workspace-status
        // card, so every composer popover speaks one UI language.
        <ComposerPopoverSurface
          variant="summary"
          className="w-[min(300px,calc(100vw-1rem))] overflow-hidden rounded-lg p-0 pt-2.5 ring-0 shadow-popover"
        >
          <div className="flex max-h-[min(34rem,calc(100vh-8rem))] flex-col gap-3 overflow-y-auto pb-3">
            <StatusSection
              title="Integrations"
              detail={connectedCount > 0 ? `${connectedCount} connected` : null}
            >
              {providers.length === 0 && (
                <StatusRow
                  icon={<Globe className="icon-paired" />}
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
  const dot = composerIntegrationHealthDot(provider.health, { surface: "composer" });

  return (
    <StatusRow
      icon={<IntegrationIcon namespace={provider.namespace} className="icon-paired" />}
      label={provider.displayName}
      trailing={(
        <span className="flex shrink-0 items-center gap-2">
          {provider.needsReauth && (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              onClick={onReconnect}
              // Neutral, not warning: no --color-warning* token is painted
              // anywhere in the composer, its popover included — the health dot
              // beside this button takes the composer surface variant for the
              // same reason.
              className="shrink-0 rounded-sm px-1 text-ui text-muted-foreground hover:text-foreground"
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
