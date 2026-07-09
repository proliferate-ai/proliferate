import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";

export function GitHubAppInstallationSection({
  loading,
  installing,
  canManage,
  status,
  onInstall,
  onManage,
}: {
  loading: boolean;
  installing: boolean;
  canManage: boolean;
  status: {
    installed: boolean;
    accountLogin?: string | null;
    repositorySelection?: string | null;
    suspendedAt?: string | null;
  } | undefined;
  onInstall: () => void | Promise<void>;
  onManage: () => void | Promise<void>;
}) {
  const installed = status?.installed === true;
  const detail = installed && status?.accountLogin
    ? `Installed on @${status.accountLogin}`
    : "Repository access for cloud environments";
  const statusLabel = loading
    ? "Checking…"
    : installed
      ? "Installed"
      : "Not installed";

  return (
    <SettingsSection title="GitHub App">
      <div className="overflow-clip rounded-lg bg-foreground/5">
        <div className="flex min-h-[3.5rem] flex-col gap-2 border-b border-border-light px-3.5 py-3.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <ProviderBrandIcon
              provider="github"
              className="size-5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0">
              <div className="font-medium text-foreground">GitHub App</div>
              <div className="truncate text-muted-foreground">{detail}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="neutral">{statusLabel}</Badge>
            {canManage ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={installing}
                disabled={installing}
                onClick={() => {
                  void (installed ? onManage() : onInstall());
                }}
              >
                {installed ? "Manage" : "Install"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export function isOrganizationAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
