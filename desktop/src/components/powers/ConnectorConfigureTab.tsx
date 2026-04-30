import type { ReactNode } from "react";
import type {
  ConnectorCardStatus,
  ConnectorConfigureFocus,
  ConnectorSetupVariant,
} from "@/hooks/mcp/use-connectors-catalog-state";
import type {
  ConnectorCatalogEntry,
  SupabaseConnectorSettings,
} from "@/lib/domain/mcp/types";
import { openExternal } from "@/platform/tauri/shell";
import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";
import { ConnectorCredentialField } from "./ConnectorCredentialField";
import { SupabaseSettingsFields } from "./SupabaseSettingsFields";

export function ConnectorConfigureTab({
  disabled,
  entry,
  error,
  focus,
  isConnected,
  onSecretChange,
  onSupabaseSettingsChange,
  primaryAction,
  secretValue,
  status,
  supabaseSettings,
  variant,
}: {
  disabled: boolean;
  entry: ConnectorCatalogEntry;
  error: string | null;
  focus: ConnectorConfigureFocus;
  isConnected: boolean;
  onSecretChange: (value: string) => void;
  onSupabaseSettingsChange: (value: SupabaseConnectorSettings) => void;
  primaryAction?: ReactNode;
  secretValue: string;
  status: ConnectorCardStatus | null;
  supabaseSettings: SupabaseConnectorSettings;
  variant: ConnectorSetupVariant;
}) {
  const showReconnectBanner = focus === "reconnect" || status?.intent === "needs_reconnect";

  return (
    <div className="space-y-4">
      {showReconnectBanner && (variant === "oauth" || variant === "oauth_structured") && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Reconnect in your browser to use {entry.name} again.
        </div>
      )}

      {variant === "api_key" && (
        <ConnectorCredentialField
          autoFocus
          disabled={disabled}
          entry={entry}
          error={error}
          helperOverride={
            isConnected
              ? focus === "token"
                ? "Add a token to use this connector."
                : "Leave blank to keep the current token."
              : undefined
          }
          onChange={onSecretChange}
          value={secretValue}
        />
      )}

      {variant === "oauth" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{entry.description}</p>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>You'll finish setup in your browser.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { void openExternal(entry.docsUrl); }}
            >
              Learn more
              <ExternalLink className="size-3" />
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {variant === "oauth_structured" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{entry.description}</p>
          <SupabaseSettingsFields
            settings={supabaseSettings}
            onChange={onSupabaseSettingsChange}
            error={error}
            disabled={disabled}
            helperText={
              isConnected
                ? "Changing project scope or read-only mode requires reconnecting in your browser."
                : "We'll authorize the specific project and access mode you choose here."
            }
          />
        </div>
      )}

      {variant === "no_setup" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{entry.description}</p>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>This connector doesn't need any saved credentials.</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { void openExternal(entry.docsUrl); }}
            >
              Learn more
              <ExternalLink className="size-3" />
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {primaryAction && (
        <div className="pt-1">
          {primaryAction}
        </div>
      )}
    </div>
  );
}
