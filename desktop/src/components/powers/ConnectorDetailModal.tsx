import { useEffect, useState } from "react";
import type {
  ConnectorModalTab,
  ResolvedConnectorModal,
} from "@/hooks/mcp/use-connectors-catalog-state";
import { validateOAuthConnectorSettings } from "@/lib/domain/mcp/oauth";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  ConnectOAuthConnectorResult,
  SupabaseConnectorSettings,
} from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
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

  useEffect(() => {
    setSecretValue("");
    setSupabaseSettings(existingSettings);
    setError(null);
  }, [entry.id, connectionId, existingSettings]);

  const { variant } = modal;
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

  async function handleCancelOAuth() {
    try {
      await callbacks.onCancelOAuth();
    } catch {
      // ignore
    }
  }

  const primary = resolvePrimaryButton({
    isConnected,
    variant,
    trimmedSecret,
    secretValidationError,
    oauthValidationError,
  });

  const status = modal.kind === "manage" ? modal.status : null;
  const focus = modal.kind === "manage" ? modal.focus : null;

  const primaryButton = modal.tab !== "configure"
    ? null
    : reconnecting
      ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => { void handleCancelOAuth(); }}
            className="w-full rounded-[10px]"
          >
            Cancel browser sign-in
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Finish authorizing in your browser, or cancel to stop waiting.
          </p>
        </div>
      )
      : primary
        ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => { void handlePrimaryAction(); }}
            loading={submitting}
            disabled={primary.disabled}
            className="w-full rounded-[10px]"
          >
            {primary.label}
          </Button>
        )
        : null;

  return (
    <ModalShell
      open
      onClose={handleClose}
      disableClose={submitting}
      sizeClassName="max-w-[480px] h-[520px] max-h-[85vh]"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      title={(
        <div className="flex items-center gap-3">
          <ConnectorIcon entry={entry} size="sm" />
          <span className="truncate text-base font-medium tracking-tight">
            {entry.name}
          </span>
        </div>
      )}
    >
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex shrink-0 gap-4 border-b border-border/60 px-5"
      >
        {TABS.map((tab) => {
          const isActive = modal.tab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSetTab(tab)}
              className={`-mb-px border-b-[1.5px] py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {modal.tab === "configure" && (
          <ConnectorConfigureTab
            disabled={submitting || reconnecting}
            entry={entry}
            error={error}
            focus={focus}
            isConnected={isConnected}
            onSecretChange={(value) => {
              setSecretValue(value);
              if (error) setError(null);
            }}
            onSupabaseSettingsChange={(value) => {
              setSupabaseSettings(value);
              if (error) setError(null);
            }}
            primaryAction={primaryButton}
            secretValue={secretValue}
            status={status}
            supabaseSettings={supabaseSettings}
            variant={variant}
          />
        )}
        {modal.tab === "tools" && <ConnectorToolsTab entry={entry} />}
        {modal.tab === "about" && <ConnectorAboutTab entry={entry} />}
      </div>
    </ModalShell>
  );
}

interface PrimaryButtonSpec {
  label: string;
  disabled: boolean;
}

function resolvePrimaryButton({
  isConnected,
  variant,
  trimmedSecret,
  secretValidationError,
  oauthValidationError,
}: {
  isConnected: boolean;
  variant: "no_setup" | "api_key" | "oauth" | "oauth_structured";
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
  return null;
}
