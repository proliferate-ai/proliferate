import { useEffect, useMemo, useState } from "react";
import type { ResolvedConnectorModal } from "@/lib/domain/mcp/connector-catalog-view-model";
import { validateOAuthConnectorSettings } from "@/lib/domain/mcp/oauth";
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
import {
  connectorLocalOAuthSuccessToast,
  hasAllConnectorSecretValues,
  hasAnyConnectorSecretValue,
  initialConnectorSecretValues,
  resolveConnectorPrimaryButton,
  validateConnectorSecretValues,
} from "@/lib/domain/mcp/detail-modal";
import { useToastStore } from "@/stores/toast/toast-store";

export type ConnectorDetailCallbacks = {
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

export function useConnectorDetailActions({
  callbacks,
  modal,
  onClose,
}: {
  callbacks: ConnectorDetailCallbacks;
  modal: ResolvedConnectorModal;
  onClose: () => void;
}) {
  const showToast = useToastStore((state) => state.show);
  const entry = modal.kind === "connect" ? modal.entry : modal.record.catalogEntry;
  const isConnected = modal.kind === "manage";
  const connectionId =
    modal.kind === "manage" ? modal.record.metadata.connectionId : null;
  const modalKind = modal.kind;
  const persistedSettings = modal.kind === "manage" ? modal.record.metadata.settings : undefined;
  const persistedSettingsKey = useMemo(
    () => JSON.stringify(persistedSettings ?? null),
    [persistedSettings],
  );
  const existingSettings = useMemo(
    () => resolveExistingSettings(entry, modalKind, persistedSettings),
    [entry, modalKind, persistedSettings],
  );

  const [secretValues, setSecretValues] = useState<Record<string, string>>(
    () => initialConnectorSecretValues(entry),
  );
  const [settings, setSettings] = useState<ConnectorSettings>(existingSettings);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    setSecretValues(initialConnectorSecretValues(entry));
    setSettings(resolveExistingSettings(entry, modalKind, persistedSettings));
    setError(null);
  }, [entry.id, connectionId, modalKind, persistedSettingsKey]);

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
    variant === "api_key" && hasAnyConnectorSecretValue(secretValues)
      ? validateConnectorSecretValues(entry, secretValues)
      : null;
  const hasRequiredSecrets =
    variant !== "api_key" || hasAllConnectorSecretValues(entry, secretValues);

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
      showToast(connectorLocalOAuthSuccessToast(entry.name, successLabel), "info");
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
        const validation =
          settingsValidationError ?? validateConnectorSecretValues(entry, secretValues);
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
      const validation =
        settingsValidationError ?? validateConnectorSecretValues(entry, secretValues);
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
      // Ignore cancel cleanup failures; the user is already leaving the flow.
    }
  }

  const primary = resolveConnectorPrimaryButton({
    entry,
    isConnected,
    variant,
    hasRequiredSecrets,
    secretValidationError,
    oauthValidationError: oauthValidationError ?? settingsValidationError,
  });

  return {
    entry,
    error,
    focus: modal.kind === "manage" ? modal.focus : null,
    handleCancelOAuth,
    handleClose,
    handlePrimaryAction,
    isConnected,
    onSecretChange: (fieldId: string, value: string) => {
      setSecretValues((current) => ({ ...current, [fieldId]: value }));
      if (error) setError(null);
    },
    onSettingsChange: (value: ConnectorSettings) => {
      setSettings(value);
      if (error) setError(null);
    },
    primary,
    reconnecting,
    secretValues,
    settings,
    status: modal.kind === "manage" ? modal.status : null,
    submitting,
    variant,
  };
}

function resolveExistingSettings(
  entry: ConnectorCatalogEntry,
  modalKind: ResolvedConnectorModal["kind"],
  persistedSettings: ConnectorSettings | undefined,
): ConnectorSettings {
  if (modalKind === "manage") {
    return normalizeConnectorSettings(entry, persistedSettings);
  }
  return createDefaultConnectorSettings(entry) ?? {};
}
