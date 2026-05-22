import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";

interface AdminOnlyPlaceholderProps {
  role?: string | null;
  onOpenOrganization?: () => void;
}

export function AdminOnlyPlaceholder({
  role,
  onOpenOrganization,
}: AdminOnlyPlaceholderProps) {
  const roleDescription = role ? `Your current role is ${role}.` : "Your current role does not allow changes here.";

  return (
    <SettingsCard>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Admin access required</p>
          <p className="text-sm text-muted-foreground">
            Organization owners and admins can configure this page. {roleDescription}
          </p>
        </div>
        {onOpenOrganization ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenOrganization}>
            Open organization
          </Button>
        ) : null}
      </div>
    </SettingsCard>
  );
}
