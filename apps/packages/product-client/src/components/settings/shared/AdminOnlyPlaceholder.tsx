import { Button } from "#product/primitives/Button";
import { SettingsEmptyState } from "#product/components/patterns/SettingsEmptyState";

interface AdminOnlyPlaceholderProps {
  role?: string | null;
  onOpenOrganization?: () => void;
}

export function AdminOnlyPlaceholder({
  role,
  onOpenOrganization,
}: AdminOnlyPlaceholderProps) {
  const roleDescription = role
    ? `Your current role is ${role}.`
    : "Your current role does not allow changes here.";

  return (
    <SettingsEmptyState
      size="compact"
      title="Admin access required"
      description={`Organization owners and admins can configure this page. ${roleDescription}`}
      action={
        onOpenOrganization ? (
          <Button type="button" variant="outline" size="sm" onClick={onOpenOrganization}>
            Open organization
          </Button>
        ) : undefined
      }
    />
  );
}
