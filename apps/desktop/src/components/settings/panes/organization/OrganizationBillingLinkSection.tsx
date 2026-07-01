import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

export function OrganizationBillingLinkSection() {
  const navigate = useNavigate();

  return (
    <SettingsSection title="Billing">
      <SettingsRow
        label="Organization billing"
        description="Manage organization plan, seats, and overage from Billing."
      >
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate(buildSettingsHref({ section: "billing" }))}
        >
          Open billing
          <ChevronRight className="size-4" />
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
