import { useState } from "react";
import { Copy, RefreshCw, ShieldCheckFilled, Trash } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsSection } from "./SettingsSection";
import { SettingsPageHeader } from "./SettingsPageHeader";

export interface OrganizationSsoConnectionView {
  id: string;
  status: "draft" | "enabled" | "disabled";
  displayName: string;
  oidcRedirectUri: string;
  oidcClientSecretConfigured: boolean;
  testedAt?: string | null;
  lastError?: string | null;
}

export interface OrganizationSsoFormState {
  displayName: string;
  allowedDomains: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcScopes: string;
  oidcTokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
}

interface OrganizationSsoSettingsSurfaceProps {
  connection: OrganizationSsoConnectionView | null;
  form: OrganizationSsoFormState;
  loading?: boolean;
  saving?: boolean;
  testing?: boolean;
  enabling?: boolean;
  disabling?: boolean;
  deleting?: boolean;
  hasUnsavedChanges?: boolean;
  error?: string | null;
  onFormChange: (form: OrganizationSsoFormState) => void;
  onSave: () => void;
  onTest: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onCopyRedirectUri?: () => void;
}

export function OrganizationSsoSettingsSurface({
  connection,
  form,
  loading = false,
  saving = false,
  testing = false,
  enabling = false,
  disabling = false,
  deleting = false,
  hasUnsavedChanges = false,
  error = null,
  onFormChange,
  onSave,
  onTest,
  onEnable,
  onDisable,
  onDelete,
  onRetry,
  onCopyRedirectUri,
}: OrganizationSsoSettingsSurfaceProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const busy = saving || testing || enabling || disabling || deleting;
  const statusActionDisabled = busy || hasUnsavedChanges;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Single sign-on"
        description="Configure organization OIDC sign-in for managed cloud users."
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={busy}
            loading={loading}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        )}
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-ui-sm leading-[1.45] text-destructive">
          {error}
        </div>
      ) : null}

      {/* Connection status */}
      <SettingsSection title="Connection">
        <div className="overflow-clip rounded-lg bg-foreground/5">
          <div className="flex min-h-[3.5rem] flex-col gap-2 px-3.5 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <ShieldCheckFilled className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {connection?.displayName || "OIDC connection"}
                </div>
                <div className="truncate text-muted-foreground">
                  {connection ? issuerHost(form.oidcIssuerUrl) : "Not configured"}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="neutral">
                {connection ? statusLabel(connection.status, connection.testedAt) : "Not configured"}
              </Badge>
              {connection ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={testing}
                  disabled={statusActionDisabled}
                  onClick={onTest}
                >
                  Test
                </Button>
              ) : null}
              {connection?.status === "enabled" ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={disabling}
                  disabled={busy}
                  onClick={onDisable}
                >
                  Disable
                </Button>
              ) : connection ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={enabling}
                  disabled={statusActionDisabled}
                  onClick={onEnable}
                >
                  Enable
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {connection?.lastError ? (
          <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-ui-sm leading-[1.45] text-warning">
            {connection.lastError}
          </div>
        ) : null}
      </SettingsSection>

      {/* Identity provider configuration */}
      <SettingsSection
        title="Identity provider"
        description="OIDC provider details from your identity platform."
      >
        <div className="overflow-clip rounded-lg bg-foreground/5">
          <div className="grid gap-4 px-3.5 py-4 sm:grid-cols-2">
            <FormField label="Display name">
              <Input
                value={form.displayName}
                onChange={(e) => updateForm(onFormChange, form, "displayName", e.target.value)}
                disabled={busy}
              />
            </FormField>
            <FormField label="Allowed domains" hint="Comma-separated email domains.">
              <Input
                value={form.allowedDomains}
                onChange={(e) => updateForm(onFormChange, form, "allowedDomains", e.target.value)}
                placeholder="company.com"
                disabled={busy}
              />
            </FormField>
            <FormField label="Issuer URL" className="sm:col-span-2">
              <Input
                value={form.oidcIssuerUrl}
                onChange={(e) => updateForm(onFormChange, form, "oidcIssuerUrl", e.target.value)}
                placeholder="https://idp.example.com"
                disabled={busy}
              />
            </FormField>
            <FormField label="Client ID">
              <Input
                value={form.oidcClientId}
                onChange={(e) => updateForm(onFormChange, form, "oidcClientId", e.target.value)}
                disabled={busy}
                data-telemetry-mask
              />
            </FormField>
            <FormField
              label="Client secret"
              hint={connection?.oidcClientSecretConfigured ? "Leave blank to keep saved secret." : undefined}
            >
              <Input
                type="password"
                value={form.oidcClientSecret}
                onChange={(e) => updateForm(onFormChange, form, "oidcClientSecret", e.target.value)}
                disabled={busy}
                data-telemetry-mask
              />
            </FormField>
            <FormField label="Scopes">
              <Input
                value={form.oidcScopes}
                onChange={(e) => updateForm(onFormChange, form, "oidcScopes", e.target.value)}
                disabled={busy}
              />
            </FormField>
            <FormField label="Token auth method">
              <Select
                value={form.oidcTokenEndpointAuthMethod}
                onChange={(e) =>
                  updateForm(
                    onFormChange,
                    form,
                    "oidcTokenEndpointAuthMethod",
                    e.target.value as OrganizationSsoFormState["oidcTokenEndpointAuthMethod"],
                  )
                }
                disabled={busy}
              >
                <option value="client_secret_basic">Client secret basic</option>
                <option value="client_secret_post">Client secret post</option>
                <option value="none">None</option>
              </Select>
            </FormField>
          </div>
        </div>
      </SettingsSection>

      {/* Redirect URI */}
      <SettingsSection title="Redirect URI">
        <div className="overflow-clip rounded-lg bg-foreground/5">
          <div className="flex items-center gap-2 px-3.5 py-3.5">
            <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-muted-foreground">
              {connection?.oidcRedirectUri ?? "Save a connection to generate the redirect URI."}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy redirect URI"
              disabled={!connection || busy}
              onClick={onCopyRedirectUri}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
      </SettingsSection>

      {/* Save + Delete footer */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {connection ? (
            <Button
              variant="ghost"
              size="sm"
              loading={deleting}
              disabled={busy}
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash className="size-3.5" />
              Delete connection
            </Button>
          ) : null}
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={busy}
          onClick={onSave}
        >
          Save
        </Button>
      </div>

      <ConfirmationDialog
        open={deleteConfirmOpen}
        title={connection ? `Delete ${connection.displayName}?` : "Delete SSO connection?"}
        description="Organization SSO sign-in will stop using this connection until an admin saves and enables another one."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          onDelete();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function FormField({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-ui-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-ui-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateForm<K extends keyof OrganizationSsoFormState>(
  onFormChange: (form: OrganizationSsoFormState) => void,
  form: OrganizationSsoFormState,
  key: K,
  value: OrganizationSsoFormState[K],
) {
  onFormChange({ ...form, [key]: value });
}

function issuerHost(url: string): string {
  if (!url.trim()) return "No issuer configured";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusLabel(
  status: OrganizationSsoConnectionView["status"],
  testedAt?: string | null,
): string {
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  if (testedAt) return "Tested";
  return "Draft";
}
