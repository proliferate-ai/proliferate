import { Button } from "#product/primitives/Button";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { ProviderBrandIcon } from "#product/components/auth/ProviderBrandIcon";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";

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
      <RosterRow
        density="comfortable"
        leading={<ProviderBrandIcon provider="github" className="icon-large text-foreground" />}
        title="GitHub App"
        secondary={detail}
        trailing={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="min-w-0 truncate text-ui-sm text-muted-foreground">{statusLabel}</span>
            {canManage ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={installing}
                disabled={installing}
                className="shrink-0"
                onClick={() => {
                  void (installed ? onManage() : onInstall());
                }}
              >
                {installed ? "Manage" : "Install"}
              </Button>
            ) : null}
          </div>
        )}
      />
    </SettingsSection>
  );
}

export function isOrganizationAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
