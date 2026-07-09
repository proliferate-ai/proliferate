import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Blocks, Settings } from "@proliferate/ui/icons";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";
import { useComposerIntegrationsState } from "@/hooks/cloud/derived/use-composer-integrations-state";
import {
  composerIntegrationHealthDot,
  type ComposerIntegrationProvider,
} from "@/lib/domain/cloud/composer-integrations";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

/**
 * The single composer integrations control. Hidden when nothing is connected;
 * a quiet plug + count when every connected integration is healthy; and the
 * old reauth chip's urgent warning presentation the moment one needs
 * re-authentication. Clicking (in any visible state) opens a popover listing
 * the connected providers, each with a health dot and — when it needs
 * re-authentication — a Reconnect affordance that deep-links to Settings.
 */
export function ComposerIntegrationsControl() {
  const navigate = useNavigate();
  const { mode, connectedCount, providers, reauthLabel } = useComposerIntegrationsState();

  if (mode === "hidden") {
    return null;
  }

  const goToIntegrations = () =>
    navigate(buildSettingsHref({ section: "integrations" }));

  const isUrgent = mode === "urgent" && reauthLabel !== null;
  const triggerLabel = isUrgent ? reauthLabel : String(connectedCount);
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
          label={triggerLabel}
          aria-label={triggerAriaLabel}
          icon={
            isUrgent ? (
              <span
                aria-hidden="true"
                className="block size-1.5 rounded-full bg-warning/70"
              />
            ) : (
              <Blocks aria-hidden="true" className="size-4" />
            )
          }
        />
      )}
    >
      {(close) => (
        <ComposerPopoverSurface className="w-72 p-1.5">
          <div className="space-y-0.5">
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
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <PopoverMenuItem
              icon={<Settings className="size-4" />}
              label="Manage integrations"
              onClick={() => {
                goToIntegrations();
                close();
              }}
            />
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function ProviderRow({
  provider,
  onReconnect,
}: {
  provider: ComposerIntegrationProvider;
  onReconnect: () => void;
}) {
  const dot = composerIntegrationHealthDot(provider.health);

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <IntegrationIcon namespace={provider.namespace} className="size-5 rounded-md" />
      <span className="min-w-0 flex-1 truncate text-ui-sm text-popover-foreground">
        {provider.displayName}
      </span>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${dot.className}`}
      />
      <span className="sr-only">{dot.label}</span>
      {provider.needsReauth ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 rounded-md px-2 text-ui-sm text-warning"
          onClick={onReconnect}
        >
          Reconnect
        </Button>
      ) : null}
    </div>
  );
}
