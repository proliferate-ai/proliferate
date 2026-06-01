import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

import { SettingsActionButton } from "./SettingsActionButton";

export function SupportSettingsSection({ onOpenSupport }: { onOpenSupport: () => void }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Support"
        description="Open the dedicated support page for cloud sessions, automations, billing, and Desktop handoff."
      />
      <SettingsCard>
        <SettingsCardRow
          label="Product support"
          description="Send a support message with account and page context."
        >
          <SettingsActionButton onClick={onOpenSupport}>Open support</SettingsActionButton>
        </SettingsCardRow>
        <SettingsCardRow
          label="Support context"
          description="Support messages are telemetry-blocked and include the current app location."
        />
      </SettingsCard>
    </section>
  );
}
