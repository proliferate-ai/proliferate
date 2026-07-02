import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
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
  const repositorySelection = formatRepositorySelection(status?.repositorySelection ?? null);
  const statusLabel = loading
    ? "Checking"
    : installed
      ? "Installed"
      : "Not installed";
  const description = installed
    ? `Installed on ${status?.accountLogin ? `@${status.accountLogin}` : "this GitHub account"}${repositorySelection ? ` with ${repositorySelection}` : ""}.`
    : canManage
      ? "Install the Proliferate GitHub App for this organization before members can enable cloud repositories."
      : "Ask an organization admin to install the Proliferate GitHub App before you enable cloud repositories.";

  return (
    <SettingsSection
      title="GitHub App"
      description="Repository access for organization cloud environments."
    >
      <SettingsRow
        label="Organization installation"
        description={description}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={installed ? "success" : "warning"}>{statusLabel}</Badge>
          {canManage ? (
            <Button
              type="button"
              variant="secondary"
              loading={installing}
              disabled={installing}
              onClick={() => {
                void (installed ? onManage() : onInstall());
              }}
            >
              {!installing ? <ProviderBrandIcon provider="github" className="size-[13px]" /> : null}
              {installed ? "Manage in GitHub" : "Install GitHub App"}
            </Button>
          ) : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

export function isOrganizationAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

function formatRepositorySelection(repositorySelection: string | null): string | null {
  if (repositorySelection === "all") {
    return "all repositories";
  }
  if (repositorySelection === "selected") {
    return "selected repositories";
  }
  return null;
}
