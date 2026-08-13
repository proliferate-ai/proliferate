import { useNavigate } from "react-router-dom";
import { Button } from "#product/primitives/Button";
import { ChevronRight } from "#product/primitives/icons/core";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";

export function OrganizationBillingLinkSection() {
  const navigate = useNavigate();

  return (
    <SettingsSection title="Billing">
      <SettingsRow label="Billing" description="Plan, seats, and usage">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => navigate(buildSettingsHref({ section: "billing" }))}
        >
          Open billing
          <ChevronRight className="icon-paired" />
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
