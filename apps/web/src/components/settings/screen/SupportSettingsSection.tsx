import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";

export function SupportSettingsSection({ onOpenSupport }: { onOpenSupport: () => void }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Support"
        description="Open the dedicated support page for cloud sessions, workflows, billing, and Desktop handoff."
      />
      <SettingsSection>
        <SettingsRow
          label="Product support"
          description="Send a support message with account and page context."
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onOpenSupport}
          >
            Open support
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Support context"
          description="Support messages are telemetry-blocked and include the current app location."
        />
      </SettingsSection>
    </section>
  );
}
