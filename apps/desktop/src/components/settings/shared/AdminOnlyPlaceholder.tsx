import { Button } from "@proliferate/ui/primitives/Button";

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
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="text-sm font-medium text-foreground">Admin access required</div>
      <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">
        Organization owners and admins can configure this page. {roleDescription}
      </p>
      {onOpenOrganization ? (
        <div className="mt-2">
          <Button type="button" variant="outline" size="sm" onClick={onOpenOrganization}>
            Open organization
          </Button>
        </div>
      ) : null}
    </div>
  );
}
