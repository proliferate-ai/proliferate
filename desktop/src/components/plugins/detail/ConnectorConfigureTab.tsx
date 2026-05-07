import type { ReactNode } from "react";
import type {
  ConnectorCardStatus,
  ConnectorConfigureFocus,
  ConnectorSetupVariant,
} from "@/hooks/mcp/use-connectors-catalog-state";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
} from "@/lib/domain/mcp/types";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";
import { ConnectorSecretFields } from "@/components/plugins/fields/ConnectorSecretFields";
import { ConnectorSettingsFields } from "@/components/plugins/fields/ConnectorSettingsFields";

export function ConnectorConfigureTab({
  disabled,
  entry,
  error,
  focus,
  isConnected,
  onSecretChange,
  onSettingsChange,
  primaryAction,
  secretValues,
  settings,
  status,
  variant,
}: {
  disabled: boolean;
  entry: ConnectorCatalogEntry;
  error: string | null;
  focus: ConnectorConfigureFocus;
  isConnected: boolean;
  onSecretChange: (fieldId: string, value: string) => void;
  onSettingsChange: (value: ConnectorSettings) => void;
  primaryAction?: ReactNode;
  secretValues: Record<string, string>;
  settings: ConnectorSettings;
  status: ConnectorCardStatus | null;
  variant: ConnectorSetupVariant;
}) {
  const showReconnectBanner = focus === "reconnect" || status?.intent === "needs_reconnect";
  const { openExternal } = useTauriShellActions();

  return (
    <div className="space-y-4">
      {showReconnectBanner && (
        variant === "oauth"
        || variant === "oauth_structured"
        || variant === "local_oauth"
      ) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Reconnect in your browser to use {entry.name} again.
        </div>
      )}

      {variant === "api_key" && (
        <div className="space-y-4">
          {entry.settingsSchema.length > 0 && (
            <ConnectorSettingsFields
              disabled={disabled}
              entry={entry}
              error={null}
              helperText={
                isConnected
                  ? "Changing these settings updates future launches for this connector."
                  : "Choose these settings before saving credentials."
              }
              onChange={onSettingsChange}
              settings={settings}
            />
          )}
          <ConnectorSecretFields
            autoFocus={entry.settingsSchema.length === 0}
            disabled={disabled}
            entry={entry}
            error={error}
            onChange={onSecretChange}
            values={secretValues}
          />
          {isConnected && focus === "token" && (
            <p className="text-xs text-muted-foreground">
              Add a token to use this connector.
            </p>
          )}
        </div>
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
          <ConnectorSettingsFields
            settings={settings}
            onChange={onSettingsChange}
            entry={entry}
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

      {variant === "local_oauth" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{entry.description}</p>
          {isConnected ? (
            <ConnectorSettingsFields
              settings={settings}
              onChange={onSettingsChange}
              entry={entry}
              error={error}
              disabled
              helperText="This Gmail account is local to this desktop. Delete and reconnect to use another account."
            />
          ) : (
            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Choose the Gmail account in your browser. Gmail is available only in new local desktop sessions with plugins enabled.
            </div>
          )}
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
