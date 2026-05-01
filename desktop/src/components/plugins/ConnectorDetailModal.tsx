import { useEffect, useMemo, useState } from "react";
import type {
  ConnectorModalTab,
  ResolvedConnectorModal,
} from "@/hooks/mcp/use-connectors-catalog-state";
import { validateOAuthConnectorSettings } from "@/lib/domain/mcp/oauth";
import { getConnectorSecretFields } from "@/lib/domain/mcp/catalog";
import {
  createDefaultConnectorSettings,
  normalizeConnectorSettings,
  validateConnectorSettings,
} from "@/lib/domain/mcp/settings-schema";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  ConnectOAuthConnectorResult,
} from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";
import { useToastStore } from "@/stores/toast/toast-store";
import { Button } from "@/components/ui/Button";
import { ModalShell } from "@/components/ui/ModalShell";
import { ConnectorAboutTab } from "./ConnectorAboutTab";
import { ConnectorConfigureTab } from "./ConnectorConfigureTab";
import { ConnectorIcon } from "./ConnectorIcon";
import { ConnectorToolsTab } from "./ConnectorToolsTab";

type DetailCallbacks = {
  onCancelOAuth: () => Promise<void>;
  onConnectOAuth: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onDelete: (connectionId: string, catalogEntryId: ConnectorCatalogEntry["id"]) => Promise<void>;
  onInstallSecret: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretFields: Record<string, string>,
    settings?: ConnectorSettings,
  ) => Promise<void>;
  onReconnect: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onUpdateSecret: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretFields: Record<string, string>,
    settings?: ConnectorSettings,
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
  const existingSettings = useMemo(() => {
    if (modal.kind === "manage") {
      return normalizeConnectorSettings(entry, modal.record.metadata.settings);
    }
    return createDefaultConnectorSettings(entry) ?? {};
  }, [entry, modal]);

  const [secretValues, setSecretValues] = useState<Record<string, string>>(
    () => initialSecretValues(entry),
  );
  const [settings, setSettings] = useState<ConnectorSettings>(existingSettings);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    setSecretValues(initialSecretValues(entry));
    setSettings(existingSettings);
    setError(null);
  }, [entry.id, connectionId, existingSettings]);

  const { variant } = modal;
  const isInitialLocalOAuthConnect = modal.kind === "connect" && variant === "local_oauth";
  const oauthEntry =
    entry.transport === "http" && entry.authKind === "oauth" ? entry : null;
  const oauthValidationError = oauthEntry
    ? validateOAuthConnectorSettings(
        oauthEntry,
        entry.settingsSchema.length > 0 ? settings : undefined,
      )
    : null;
  const settingsValidationError = !isInitialLocalOAuthConnect && entry.settingsSchema.length > 0
    ? validateConnectorSettings(entry, settings)
    : null;
  const secretValidationError =
    variant === "api_key" && hasAnySecretValue(secretValues)
      ? validateSecretValues(entry, secretValues)
      : null;
  const hasRequiredSecrets = variant !== "api_key" || hasAllSecretValues(entry, secretValues);

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

  async function runLocalOAuth(op: () => Promise<void>, successLabel: string) {
    setReconnecting(true);
    setError(null);
    try {
      await op();
      showToast(localOAuthSuccessToast(entry.name, successLabel), "info");
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
        const validation = settingsValidationError ?? validateSecretValues(entry, secretValues);
        if (validation) {
          setError(validation);
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          await callbacks.onInstallSecret(entry.id, secretValues, settings);
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
          await callbacks.onInstallSecret(entry.id, {}, settings);
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
      if (variant === "local_oauth") {
        const validation = settingsValidationError;
        if (validation) {
          setError(validation);
          return;
        }
        await runLocalOAuth(
          () => callbacks.onInstallSecret(entry.id, {}, settings),
          "connected",
        );
        return;
      }
      await runOauth(
        () =>
          callbacks.onConnectOAuth(
            entry.id,
            entry.settingsSchema.length > 0 ? settings : undefined,
          ),
        "connected",
      );
      return;
    }

    if (!connectionId) return;
    if (variant === "api_key") {
      const validation = settingsValidationError ?? validateSecretValues(entry, secretValues);
      if (validation) {
        setError(validation);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        await callbacks.onUpdateSecret(connectionId, entry.id, secretValues, settings);
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
    if (variant === "local_oauth") {
      await runLocalOAuth(
        () =>
          callbacks.onReconnect(
            connectionId,
            entry.id,
            entry.settingsSchema.length > 0 ? settings : undefined,
          ).then(() => undefined),
        "reconnected",
      );
      return;
    }
    await runOauth(
      () =>
        callbacks.onReconnect(
          connectionId,
          entry.id,
          entry.settingsSchema.length > 0 ? settings : undefined,
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
    entry,
    isConnected,
    variant,
    hasRequiredSecrets,
    secretValidationError,
    oauthValidationError: oauthValidationError ?? settingsValidationError,
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
            onSecretChange={(fieldId, value) => {
              setSecretValues((current) => ({ ...current, [fieldId]: value }));
              if (error) setError(null);
            }}
            onSettingsChange={(value) => {
              setSettings(value);
              if (error) setError(null);
            }}
            primaryAction={primaryButton}
            secretValues={secretValues}
            settings={settings}
            status={status}
            variant={variant}
          />
        )}
        {modal.tab === "tools" && <ConnectorToolsTab entry={entry} />}
        {modal.tab === "about" && <ConnectorAboutTab entry={entry} />}
      </div>
    </ModalShell>
  );
}

function initialSecretValues(entry: ConnectorCatalogEntry): Record<string, string> {
  return Object.fromEntries(getConnectorSecretFields(entry).map((field) => [field.id, ""]));
}

function hasAnySecretValue(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value.trim().length > 0);
}

function hasAllSecretValues(
  entry: ConnectorCatalogEntry,
  values: Record<string, string>,
): boolean {
  return getConnectorSecretFields(entry).every(
    (field) => (values[field.id] ?? "").trim().length > 0,
  );
}

function localOAuthSuccessToast(entryName: string, successLabel: string): string {
  if (successLabel === "reconnected") {
    return `${entryName} reconnected. Restart or resume the local session to refresh tools.`;
  }
  return `${entryName} connected. Start a new local session with plugins enabled to use it.`;
}

function validateSecretValues(
  entry: ConnectorCatalogEntry,
  values: Record<string, string>,
): string | null {
  for (const field of getConnectorSecretFields(entry)) {
    const validation = validateConnectorSecretValue(values[field.id] ?? "");
    if (validation) {
      return `${field.label}: ${validation}`;
    }
  }
  return null;
}

interface PrimaryButtonSpec {
  label: string;
  disabled: boolean;
}

function resolvePrimaryButton({
  entry,
  isConnected,
  variant,
  hasRequiredSecrets,
  secretValidationError,
  oauthValidationError,
}: {
  entry: ConnectorCatalogEntry;
  isConnected: boolean;
  variant: "no_setup" | "local_oauth" | "api_key" | "oauth" | "oauth_structured";
  hasRequiredSecrets: boolean;
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
        disabled: !hasRequiredSecrets || Boolean(secretValidationError) || Boolean(oauthValidationError),
      };
    }
    if (variant === "local_oauth") {
      return {
        label: "Connect in browser",
        disabled: Boolean(oauthValidationError),
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
      disabled: !hasRequiredSecrets || Boolean(secretValidationError) || Boolean(oauthValidationError),
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
  if (variant === "local_oauth") {
    if (entry.transport === "stdio" && entry.command.length === 0) {
      return null;
    }
    return { label: "Reconnect", disabled: Boolean(oauthValidationError) };
  }
  return null;
}
