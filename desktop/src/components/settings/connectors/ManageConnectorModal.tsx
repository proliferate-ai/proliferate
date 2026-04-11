import { useEffect, useState } from "react";
import {
  validateOAuthConnectorSettings,
} from "@/lib/domain/mcp/oauth";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  InstalledConnectorRecord,
  SupabaseConnectorSettings,
} from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type { ConnectOAuthConnectorResult } from "@/platform/tauri/mcp-oauth";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { DeleteConnectorModal } from "./DeleteConnectorModal";
import {
  ConnectorCredentialField,
  ConnectorDetailsBlock,
  SupabaseSettingsFields,
} from "./ConnectorShared";

const DEFAULT_SUPABASE_SETTINGS: SupabaseConnectorSettings = {
  kind: "supabase",
  projectRef: "",
  readOnly: true,
};

export function ManageConnectorModal({
  onClose,
  onDelete,
  onCancelOAuth,
  onReconnect,
  onRetry,
  onSaveSecret,
  record,
}: {
  onClose: () => void;
  onDelete: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<void>;
  onCancelOAuth: () => Promise<void>;
  onReconnect: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onRetry: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<boolean>;
  onSaveSecret: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretValue: string,
  ) => Promise<void>;
  record: InstalledConnectorRecord | null;
}) {
  const showToast = useToastStore((state) => state.show);
  const [secretValue, setSecretValue] = useState("");
  const [supabaseSettings, setSupabaseSettings] = useState<SupabaseConnectorSettings>(
    DEFAULT_SUPABASE_SETTINGS,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSecretValue("");
    setSupabaseSettings(
      record?.metadata.settings?.kind === "supabase"
        ? record.metadata.settings
        : DEFAULT_SUPABASE_SETTINGS,
    );
    setError(null);
    setConfirmDeleteOpen(false);
  }, [record]);

  if (!record) {
    return null;
  }
  const activeRecord = record;
  const oauthEntry =
    activeRecord.catalogEntry.transport === "http" && activeRecord.catalogEntry.authKind === "oauth"
      ? activeRecord.catalogEntry
      : null;
  const hasCredentialField = !oauthEntry && activeRecord.catalogEntry.requiredFields.length > 0;
  const validationError = hasCredentialField && secretValue
    ? validateConnectorSecretValue(secretValue)
    : null;
  const oauthValidationError = oauthEntry
    ? validateOAuthConnectorSettings(
        oauthEntry,
        oauthEntry.id === "supabase" ? supabaseSettings : undefined,
      )
    : null;
  const canSave = hasCredentialField && secretValue.trim().length > 0 && !validationError;
  const reconnectLabel = activeRecord.catalogEntry.id === "supabase"
    ? "Save & reconnect"
    : "Reconnect";
  const oauthBusy = Boolean(oauthEntry) && reconnecting;

  function handleClose() {
    if (oauthBusy) {
      void onCancelOAuth().catch(() => undefined);
    }
    onClose();
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSaveSecret(
        activeRecord.metadata.connectionId,
        activeRecord.catalogEntry.id,
        secretValue,
      );
      showToast(`${activeRecord.catalogEntry.name} updated.`, "info");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : `Couldn't update ${activeRecord.catalogEntry.name}. Try again.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReconnect() {
    if (oauthValidationError) {
      setError(oauthValidationError);
      return;
    }
    setReconnecting(true);
    setError(null);
    try {
      const result = await onReconnect(
        activeRecord.metadata.connectionId,
        activeRecord.catalogEntry.id,
        activeRecord.catalogEntry.id === "supabase" ? supabaseSettings : undefined,
      );
      if (result.kind === "canceled") {
        return;
      }
      showToast(`${activeRecord.catalogEntry.name} connected.`, "info");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : `Couldn't reconnect ${activeRecord.catalogEntry.name}. Try again.`,
      );
    } finally {
      setReconnecting(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await onRetry(activeRecord.metadata.connectionId, activeRecord.catalogEntry.id);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <ModalShell
        open={!!record}
        onClose={handleClose}
        disableClose={submitting}
        title={activeRecord.catalogEntry.name}
        description={activeRecord.catalogEntry.oneLiner}
        footer={(
          <>
            <Button
              type="button"
              variant="destructive"
              size="md"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={submitting || retrying || reconnecting}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={handleClose}
              disabled={submitting}
            >
              {hasCredentialField ? "Cancel" : "Close"}
            </Button>
            {hasCredentialField && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => { void handleSave(); }}
                loading={submitting}
                disabled={!canSave}
              >
                Save
              </Button>
            )}
            {oauthEntry && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => { void handleReconnect(); }}
                loading={reconnecting}
                disabled={Boolean(oauthValidationError) || submitting}
              >
                {reconnectLabel}
              </Button>
            )}
          </>
        )}
      >
        <div className="space-y-4">
          {activeRecord.metadata.syncState === "degraded" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <span>Cloud sync couldn't finish. We'll retry automatically.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { void handleRetry(); }}
                disabled={retrying || submitting || reconnecting}
                aria-label={`Retry sync for ${activeRecord.catalogEntry.name}`}
              >
                Retry
              </Button>
            </div>
          )}
          {hasCredentialField ? (
            <ConnectorCredentialField
              entry={activeRecord.catalogEntry}
              error={error}
              helperOverride={activeRecord.broken
                ? "Add a token to use this connector."
                : "Leave blank to keep the current token."}
              onChange={(nextValue) => {
                setSecretValue(nextValue);
                if (error) {
                  setError(null);
                }
              }}
              showValue={false}
              value={secretValue}
              disabled={submitting}
            />
          ) : activeRecord.catalogEntry.id === "supabase" ? (
            <div className="space-y-4">
              <ConnectorDetailsBlock entry={activeRecord.catalogEntry} />
              <SupabaseSettingsFields
                settings={supabaseSettings}
                onChange={(nextSettings) => {
                  setSupabaseSettings(nextSettings);
                  if (error) {
                    setError(null);
                  }
                }}
                error={error}
                disabled={submitting || reconnecting}
                helperText={activeRecord.broken
                  ? "Reconnect after reviewing these settings to use Supabase again."
                  : "Changing project scope or read-only mode requires reconnecting in your browser."}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <ConnectorDetailsBlock entry={activeRecord.catalogEntry} />
              {activeRecord.broken && (
                <p className="text-xs text-muted-foreground">
                  Reconnect in your browser to use this connector again.
                </p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>
      </ModalShell>
      <DeleteConnectorModal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onDelete={onDelete}
        record={activeRecord}
      />
    </>
  );
}
