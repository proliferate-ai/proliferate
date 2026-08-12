import { Button } from "#product/primitives/Button";
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
      <div className="flex items-center gap-3.5 px-3.5 py-[13px]">
        <div className="flex w-5 shrink-0 items-center justify-center">
          <ProviderBrandIcon provider="github" className="icon-large text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ui text-foreground">GitHub App</div>
          <div className="mt-px truncate text-ui-sm text-muted-foreground [text-wrap:pretty]">{detail}</div>
        </div>
        <span className="shrink-0 text-ui-sm text-muted-foreground">{statusLabel}</span>
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
    </SettingsSection>
  );
}

export function isOrganizationAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
