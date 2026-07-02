import { useNavigate } from "react-router-dom";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { useIntegrationReauthState } from "@/hooks/cloud/derived/use-integration-reauth-state";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

/**
 * Quiet composer pill shown only when one or more connected integrations
 * report `needs_reauth`. Clicking opens Settings at the user integrations
 * section, where the reconnect action lives.
 */
export function ComposerIntegrationReauthChip() {
  const navigate = useNavigate();
  const reauth = useIntegrationReauthState();

  if (!reauth.visible || reauth.label === null) {
    return null;
  }

  return (
    <Tooltip content="Reconnect in Settings to restore this integration's tools.">
      <ComposerControlButton
        label={reauth.label}
        aria-label={`${reauth.label}. Open integration settings.`}
        icon={(
          <span
            aria-hidden="true"
            className="block size-1.5 rounded-full bg-warning/70"
          />
        )}
        onClick={() => navigate(buildSettingsHref({ section: "integrations" }))}
      />
    </Tooltip>
  );
}
