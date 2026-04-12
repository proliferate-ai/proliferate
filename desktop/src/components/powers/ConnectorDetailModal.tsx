import { useEffect, useId, useState } from "react";
import type {
  ConnectorModalTab,
  ResolvedConnectorModal,
} from "@/hooks/mcp/use-connectors-catalog-state";
import { validateOAuthConnectorSettings } from "@/lib/domain/mcp/oauth";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  SupabaseConnectorSettings,
} from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import type { ConnectOAuthConnectorResult } from "@/platform/tauri/mcp-oauth";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { X } from "@/components/ui/icons";
import { ConnectorAboutTab } from "./ConnectorAboutTab";
import { ConnectorConfigureTab } from "./ConnectorConfigureTab";
import { ConnectorIcon } from "./ConnectorIcon";
import { ConnectorToolsTab } from "./ConnectorToolsTab";

const DEFAULT_SUPABASE_SETTINGS: SupabaseConnectorSettings = {
  kind: "supabase",
  projectRef: "",
  readOnly: true,
};

type DetailCallbacks = {
  onCancelOAuth: () => Promise<void>;
  onConnectOAuth: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onDelete: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<void>;
  onInstallSecret: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretValue: string,
  ) => Promise<void>;
  onReconnect: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onRetrySync: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
  ) => Promise<boolean>;
  onUpdateSecret: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretValue: string,
  ) => Promise<void>;
};

const TAB_LABELS: Record<ConnectorModalTab, string> = {
  configure: "Configure",
  tools: "Tools",
  about: "About",
};

const TABS: readonly ConnectorModalTab[] = ["configure", "tools", "about"];

export function ConnectorDetailModal({
  callbacks,
  modal,
  onClose,
  onSetTab,
}: {
  callbacks: DetailCallbacks;
  modal: ResolvedConnectorModal;
  onClose: () => void;
  onSetTab: (tab: ConnectorModalTab) => void;
}) {
  const showToast = useToastStore((state) => state.show);
  const titleId = useId();
  const entry = modal.kind === "connect" ? modal.entry : modal.record.catalogEntry;
  const isConnected = modal.kind === "manage";
  const connectionId =
    modal.kind === "manage" ? modal.record.metadata.connectionId : null;
  const existingSettings =
    modal.kind === "manage" && modal.record.metadata.settings?.kind === "supabase"
      ? modal.record.metadata.settings
      : DEFAULT_SUPABASE_SETTINGS;

  const [secretValue, setSecretValue] = useState("");
  const [supabaseSettings, setSupabaseSettings] =
    useState<SupabaseConnectorSettings>(existingSettings);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setSecretValue("");
    setSupabaseSettings(existingSettings);
    setError(null);
  }, [entry.id, connectionId, existingSettings]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting && !reconnecting) {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, reconnecting]);

  const { variant } = modal;
  const busy = submitting || reconnecting;
  const oauthEntry =
    entry.transport === "http" && entry.authKind === "oauth" ? entry : null;
  const oauthValidationError = oauthEntry
    ? validateOAuthConnectorSettings(
        oauthEntry,
        variant === "oauth_structured" ? supabaseSettings : undefined,
      )
    : null;
  const trimmedSecret = secretValue.trim();
  const secretValidationError =
    variant === "api_key" && trimmedSecret.length > 0
      ? validateConnectorSecretValue(secretValue)
      : null;

  function handleClose() {
    if (reconnecting) {
      void callbacks.onCancelOAuth().catch(() => undefined);
    }
    onClose();
  }

  async function runOauth(
    op: () => Promise<ConnectOAuthConnectorResult>,
    successLabel: string,
  ) {
    if (oauthValidationError) {
      setError(oauthValidationError);
      return;
    }
    setReconnecting(true);
    setError(null);
    try {
      const result = await op();
      if (result.kind === "canceled") {
        return;
      }
      showToast(`${entry.name} ${successLabel}.`, "info");
      onClose();
    } catch (opError) {
      setError(
        opError instanceof Error
          ? opError.message
          : `Couldn't save ${entry.name}. Try again.`,
      );
    } finally {
      setReconnecting(false);
    }
  }

  async function handlePrimaryAction() {
    if (modal.kind === "connect") {
      if (variant === "api_key") {
        const validation = validateConnectorSecretValue(secretValue);
        if (validation) {
          setError(validation);
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          await callbacks.onInstallSecret(entry.id, secretValue);
          showToast(`${entry.name} connected.`, "info");
          onClose();
        } catch (opError) {
          setError(
            opError instanceof Error
              ? opError.message
              : `Couldn't save ${entry.name}. Try again.`,
          );
        } finally {
          setSubmitting(false);
        }
        return;
      }
      if (variant === "no_setup") {
        setSubmitting(true);
        setError(null);
        try {
          await callbacks.onInstallSecret(entry.id, "");
          showToast(`${entry.name} connected.`, "info");
          onClose();
        } catch (opError) {
          setError(
            opError instanceof Error
              ? opError.message
              : `Couldn't save ${entry.name}. Try again.`,
          );
        } finally {
          setSubmitting(false);
        }
        return;
      }
      await runOauth(
        () =>
          callbacks.onConnectOAuth(
            entry.id,
            variant === "oauth_structured" ? supabaseSettings : undefined,
          ),
        "connected",
      );
      return;
    }

    // manage
    if (!connectionId) return;
    if (variant === "api_key") {
      const validation = validateConnectorSecretValue(secretValue);
      if (validation) {
        setError(validation);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        await callbacks.onUpdateSecret(connectionId, entry.id, secretValue);
        showToast(`${entry.name} updated.`, "info");
        onClose();
      } catch (opError) {
        setError(
          opError instanceof Error
            ? opError.message
            : `Couldn't update ${entry.name}. Try again.`,
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (variant === "no_setup") {
      onClose();
      return;
    }
    await runOauth(
      () =>
        callbacks.onReconnect(
          connectionId,
          entry.id,
          variant === "oauth_structured" ? supabaseSettings : undefined,
        ),
      "connected",
    );
  }

  async function handleRetrySync() {
    if (!connectionId) return;
    setRetrying(true);
    try {
      await callbacks.onRetrySync(connectionId, entry.id);
    } finally {
      setRetrying(false);
    }
  }

  const primary = resolvePrimaryButton({
    isConnected,
    variant,
    secretValue,
    trimmedSecret,
    secretValidationError,
    oauthValidationError,
  });

  const status = modal.kind === "manage" ? modal.status : null;
  const focus = modal.kind === "manage" ? modal.focus : null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={busy ? undefined : handleClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative flex w-full max-w-lg flex-col rounded-xl border border-border bg-background shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <ConnectorIcon entry={entry} size="md" />
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-sm font-medium text-foreground">
                  {entry.name}
                </h2>
                <p className="truncate text-xs text-muted-foreground">{entry.oneLiner}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex gap-1 border-b border-border/60 px-5">
            {TABS.map((tab) => {
              const isActive = modal.tab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onSetTab(tab)}
                  className={`relative py-3 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  } px-3`}
                >
                  {TAB_LABELS[tab]}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-foreground"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            {modal.tab === "configure" && (
              <ConnectorConfigureTab
                busy={busy}
                disabled={submitting || reconnecting}
                entry={entry}
                error={error}
                focus={focus}
                isConnected={isConnected}
                onRetrySync={connectionId ? handleRetrySync : undefined}
                onSecretChange={(value) => {
                  setSecretValue(value);
                  if (error) setError(null);
                }}
                onSupabaseSettingsChange={(value) => {
                  setSupabaseSettings(value);
                  if (error) setError(null);
                }}
                retrying={retrying}
                secretValue={secretValue}
                status={status}
                supabaseSettings={supabaseSettings}
                variant={variant}
              />
            )}
            {modal.tab === "tools" && <ConnectorToolsTab entry={entry} />}
            {modal.tab === "about" && <ConnectorAboutTab entry={entry} />}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
            {modal.tab === "configure" ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={handleClose}
                  disabled={submitting}
                >
                  {isConnected ? "Close" : "Cancel"}
                </Button>
                {primary && (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => { void handlePrimaryAction(); }}
                    loading={submitting || reconnecting}
                    disabled={primary.disabled}
                  >
                    {primary.label}
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={handleClose}
              >
                Close
              </Button>
            )}
          </footer>
        </div>
      </div>
    </>
  );
}

interface PrimaryButtonSpec {
  label: string;
  disabled: boolean;
}

function resolvePrimaryButton({
  isConnected,
  variant,
  secretValue,
  trimmedSecret,
  secretValidationError,
  oauthValidationError,
}: {
  isConnected: boolean;
  variant: "no_setup" | "api_key" | "oauth" | "oauth_structured";
  secretValue: string;
  trimmedSecret: string;
  secretValidationError: string | null;
  oauthValidationError: string | null;
}): PrimaryButtonSpec | null {
  if (!isConnected) {
    if (variant === "no_setup") {
      return { label: "Connect", disabled: false };
    }
    if (variant === "api_key") {
      return {
        label: "Connect",
        disabled: trimmedSecret.length === 0 || Boolean(secretValidationError),
      };
    }
    return {
      label: "Connect in browser",
      disabled: Boolean(oauthValidationError),
    };
  }

  // manage
  if (variant === "api_key") {
    return {
      label: "Save",
      disabled: trimmedSecret.length === 0 || Boolean(secretValidationError),
    };
  }
  if (variant === "oauth_structured") {
    return {
      label: "Save & reconnect",
      disabled: Boolean(oauthValidationError),
    };
  }
  if (variant === "oauth") {
    return { label: "Reconnect", disabled: Boolean(oauthValidationError) };
  }
  // no_setup manage — nothing to save
  void secretValue;
  return null;
}
