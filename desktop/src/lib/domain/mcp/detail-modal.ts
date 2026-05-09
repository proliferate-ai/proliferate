import type { ConnectorSetupVariant } from "@/lib/domain/mcp/connector-catalog-view-model";
import { getConnectorSecretFields } from "@/lib/domain/mcp/catalog";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import { validateConnectorSecretValue } from "@/lib/domain/mcp/validation";

export interface ConnectorPrimaryButtonSpec {
  label: string;
  disabled: boolean;
}

export function initialConnectorSecretValues(
  entry: ConnectorCatalogEntry,
): Record<string, string> {
  return Object.fromEntries(getConnectorSecretFields(entry).map((field) => [field.id, ""]));
}

export function hasAnyConnectorSecretValue(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value.trim().length > 0);
}

export function hasAllConnectorSecretValues(
  entry: ConnectorCatalogEntry,
  values: Record<string, string>,
): boolean {
  return getConnectorSecretFields(entry).every(
    (field) => (values[field.id] ?? "").trim().length > 0,
  );
}

export function connectorLocalOAuthSuccessToast(
  entryName: string,
  successLabel: string,
): string {
  if (successLabel === "reconnected") {
    return `${entryName} reconnected. Restart or resume the local session to refresh tools.`;
  }
  return `${entryName} connected. Start a new local session with plugins enabled to use it.`;
}

export function validateConnectorSecretValues(
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

export function resolveConnectorPrimaryButton({
  entry,
  isConnected,
  variant,
  hasRequiredSecrets,
  secretValidationError,
  oauthValidationError,
}: {
  entry: ConnectorCatalogEntry;
  isConnected: boolean;
  variant: ConnectorSetupVariant;
  hasRequiredSecrets: boolean;
  secretValidationError: string | null;
  oauthValidationError: string | null;
}): ConnectorPrimaryButtonSpec | null {
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
