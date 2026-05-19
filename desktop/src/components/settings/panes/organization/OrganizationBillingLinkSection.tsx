import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@/components/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { OrganizationSection } from "@/components/settings/panes/organization/OrganizationLogo";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

export function OrganizationBillingLinkSection() {
  const navigate = useNavigate();

  return (
    <OrganizationSection title="Billing">
      <SettingsCard>
        <SettingsCardRow
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
        </SettingsCardRow>
      </SettingsCard>
    </OrganizationSection>
  );
}
