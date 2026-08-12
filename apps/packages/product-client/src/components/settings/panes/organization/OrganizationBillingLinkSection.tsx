import { useNavigate } from "react-router-dom";
import { Button } from "#product/primitives/Button";
import { ChevronRight } from "#product/primitives/icons/core";
import { SettingsSection } from "#product/components/patterns/SettingsSection";
import { buildSettingsHref } from "#product/lib/domain/settings/navigation";

export function OrganizationBillingLinkSection() {
  const navigate = useNavigate();

  return (
    <SettingsSection title="Billing">
      <div className="flex items-center gap-3.5 px-3.5 py-[13px]">
        <div className="min-w-0 flex-1">
          <div className="text-ui text-foreground">Billing</div>
          <div className="mt-px text-ui-sm text-muted-foreground [text-wrap:pretty]">Plan, seats, and usage</div>
        </div>
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
      </div>
    </SettingsSection>
  );
}
