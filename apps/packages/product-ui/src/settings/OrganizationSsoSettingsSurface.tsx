import { useState } from "react";
import { Copy, RefreshCw, ShieldCheckFilled, Trash } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsSection } from "./SettingsSection";
import { SettingsRow } from "./SettingsRow";
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
      <SettingsSection>
        <SettingsRow
          label="Connection"
          description={connection ? connection.displayName : "No SSO connection has been saved."}
        >
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(connection?.status)}>
              {connection ? statusLabel(connection.status) : "Not saved"}
            </Badge>
            {connection?.testedAt ? <Badge tone="info">Tested</Badge> : null}
          </div>
        </SettingsRow>
        <SettingsRow label="Display name">
          <Input
            className="w-full sm:w-[22rem]"
            value={form.displayName}
            onChange={(event) => updateForm(onFormChange, form, "displayName", event.target.value)}
            disabled={busy}
          />
        </SettingsRow>
        <SettingsRow
          label="Allowed domains"
          description="Comma-separated email domains."
        >
          <Input
            className="w-full sm:w-[22rem]"
            value={form.allowedDomains}
            onChange={(event) =>
              updateForm(onFormChange, form, "allowedDomains", event.target.value)
            }
            placeholder="company.com"
            disabled={busy}
          />
        </SettingsRow>
        <SettingsRow label="OIDC issuer URL">
          <Input
            className="w-full sm:w-[22rem]"
            value={form.oidcIssuerUrl}
            onChange={(event) =>
              updateForm(onFormChange, form, "oidcIssuerUrl", event.target.value)
            }
            placeholder="https://idp.example.com"
            disabled={busy}
          />
        </SettingsRow>
        <SettingsRow label="OIDC client ID">
          <Input
            className="w-full sm:w-[22rem]"
            value={form.oidcClientId}
            onChange={(event) =>
              updateForm(onFormChange, form, "oidcClientId", event.target.value)
            }
            disabled={busy}
            data-telemetry-mask
          />
        </SettingsRow>
        <SettingsRow
          label="OIDC client secret"
          description={connection?.oidcClientSecretConfigured ? "Leave blank to keep saved secret." : undefined}
        >
          <Input
            className="w-full sm:w-[22rem]"
            type="password"
            value={form.oidcClientSecret}
            onChange={(event) =>
              updateForm(onFormChange, form, "oidcClientSecret", event.target.value)
            }
            disabled={busy}
            data-telemetry-mask
          />
        </SettingsRow>
        <SettingsRow label="OIDC scopes">
          <Input
            className="w-full sm:w-[22rem]"
            value={form.oidcScopes}
            onChange={(event) =>
              updateForm(onFormChange, form, "oidcScopes", event.target.value)
            }
            disabled={busy}
          />
        </SettingsRow>
        <SettingsRow label="Token auth method">
          <Select
            className="w-full sm:w-[22rem]"
            value={form.oidcTokenEndpointAuthMethod}
            onChange={(event) =>
              updateForm(
                onFormChange,
                form,
                "oidcTokenEndpointAuthMethod",
                event.target.value as OrganizationSsoFormState["oidcTokenEndpointAuthMethod"],
              )
            }
            disabled={busy}
          >
            <option value="client_secret_basic">Client secret basic</option>
            <option value="client_secret_post">Client secret post</option>
            <option value="none">None</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Redirect URI">
          <div className="flex w-full min-w-0 gap-2 sm:w-[22rem]">
            <Input
              className="min-w-0 flex-1 font-mono text-xs"
              value={connection?.oidcRedirectUri ?? ""}
              readOnly
            />
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
        </SettingsRow>
      </SettingsSection>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {connection ? (
          <Button
            variant="destructive"
            size="sm"
            loading={deleting}
            disabled={busy}
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash className="size-3.5" />
            Delete
          </Button>
        ) : null}
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
            <ShieldCheckFilled className="size-3.5" />
            Enable
          </Button>
        ) : null}
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
      {connection?.lastError ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-ui-sm leading-[1.45] text-warning">
          {connection.lastError}
        </div>
      ) : null}
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

function updateForm<K extends keyof OrganizationSsoFormState>(
  onFormChange: (form: OrganizationSsoFormState) => void,
  form: OrganizationSsoFormState,
  key: K,
  value: OrganizationSsoFormState[K],
) {
  onFormChange({ ...form, [key]: value });
}

function statusTone(status: OrganizationSsoConnectionView["status"] | undefined) {
  if (status === "enabled") {
    return "success";
  }
  if (status === "disabled") {
    return "warning";
  }
  return "neutral";
}

function statusLabel(status: OrganizationSsoConnectionView["status"]) {
  if (status === "enabled") {
    return "Enabled";
  }
  if (status === "disabled") {
    return "Disabled";
  }
  return "Draft";
}
