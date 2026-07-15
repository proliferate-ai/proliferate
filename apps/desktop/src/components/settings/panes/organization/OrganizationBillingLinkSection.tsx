import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

export function OrganizationBillingLinkSection() {
  const navigate = useNavigate();

  return (
    <SettingsSection title="Billing">
      <div className="overflow-clip rounded-lg bg-foreground/5">
        <div className="flex min-h-[3.5rem] flex-col gap-2 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium text-foreground">Billing</div>
            <div className="text-muted-foreground">Plan, seats, and usage</div>
          </div>
          <div className="shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate(buildSettingsHref({ section: "billing" }))}
            >
              Open billing
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
