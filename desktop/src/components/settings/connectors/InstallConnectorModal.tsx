import { useEffect, useState } from "react";
import {
  validateOAuthConnectorSettings,
} from "@/lib/domain/mcp/oauth";
import type { ConnectorCatalogEntry, ConnectorSettings, SupabaseConnectorSettings } from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type { ConnectOAuthConnectorResult } from "@/platform/tauri/mcp-oauth";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
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

export function InstallConnectorModal({
  entry,
  onClose,
  onCancelOAuth,
  onConnectOAuth,
  onInstallSecret,
}: {
  entry: ConnectorCatalogEntry | null;
  onClose: () => void;
  onCancelOAuth: () => Promise<void>;
  onConnectOAuth: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onInstallSecret: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretValue: string,
  ) => Promise<void>;
}) {
  const showToast = useToastStore((state) => state.show);
  const [secretValue, setSecretValue] = useState("");
  const [supabaseSettings, setSupabaseSettings] = useState<SupabaseConnectorSettings>(
    DEFAULT_SUPABASE_SETTINGS,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSecretValue("");
    setSupabaseSettings(DEFAULT_SUPABASE_SETTINGS);
    setError(null);
  }, [entry?.id]);

  if (!entry) {
    return null;
  }
  const activeEntry = entry;
  const oauthEntry =
    activeEntry.transport === "http" && activeEntry.authKind === "oauth"
      ? activeEntry
      : null;
  const hasCredentialField = !oauthEntry && activeEntry.requiredFields.length > 0;
  const validationError = hasCredentialField ? validateConnectorSecretValue(secretValue) : null;
  const oauthValidationError = oauthEntry
    ? validateOAuthConnectorSettings(
        oauthEntry,
        oauthEntry.id === "supabase" ? supabaseSettings : undefined,
      )
    : null;
  const oauthBusy = Boolean(oauthEntry) && submitting;

  function handleClose() {
    if (oauthBusy) {
      void onCancelOAuth().catch(() => undefined);
    }
    onClose();
  }

  async function handleSubmit() {
    if (hasCredentialField && validationError) {
      setError(validationError);
      return;
    }
    if (oauthEntry && oauthValidationError) {
      setError(oauthValidationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (oauthEntry) {
        const result = await onConnectOAuth(
          activeEntry.id,
          activeEntry.id === "supabase" ? supabaseSettings : undefined,
        );
        if (result.kind === "canceled") {
          return;
        }
      } else {
        await onInstallSecret(activeEntry.id, secretValue);
      }
      showToast(`${activeEntry.name} connected.`, "info");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : `Couldn't save ${activeEntry.name}. Try again.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      open={!!entry}
      onClose={handleClose}
      disableClose={hasCredentialField && submitting}
      title={`Connect ${activeEntry.name}`}
      description={activeEntry.oneLiner}
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={handleClose}
            disabled={hasCredentialField && submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => { void handleSubmit(); }}
            loading={submitting}
            disabled={
              (hasCredentialField && Boolean(validationError))
              || (Boolean(oauthEntry) && Boolean(oauthValidationError))
            }
          >
            {submitting ? "Connecting" : "Connect"}
          </Button>
        </>
      )}
    >
      {hasCredentialField ? (
        <ConnectorCredentialField
          entry={activeEntry}
          error={error}
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
      ) : activeEntry.id === "supabase" ? (
        <div className="space-y-4">
          <ConnectorDetailsBlock entry={activeEntry} />
          <SupabaseSettingsFields
            settings={supabaseSettings}
            onChange={(nextSettings) => {
              setSupabaseSettings(nextSettings);
              if (error) {
                setError(null);
              }
            }}
            error={error}
            disabled={submitting}
            helperText="We'll authorize the specific project and access mode you choose here."
          />
        </div>
      ) : (
        <div className="space-y-4">
          <ConnectorDetailsBlock entry={activeEntry} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </ModalShell>
  );
}
