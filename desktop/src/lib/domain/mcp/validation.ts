import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";

export const CONNECTOR_SECRET_MAX_LENGTH = 512;

export function normalizeConnectorSecretValue(value: string): string {
  return value.trim();
}

export function validateConnectorSecretValue(value: string): string | null {
  const normalized = normalizeConnectorSecretValue(value);
  if (!normalized) {
    return "Enter a token.";
  }
  if (/\s/.test(normalized)) {
    return "Enter a single-line token.";
  }
  if (normalized.length > CONNECTOR_SECRET_MAX_LENGTH) {
    return "Tokens must be 512 characters or fewer.";
  }
  return null;
}

export function describeConnectorSecretHint(
  catalogEntry: ConnectorCatalogEntry,
  value: string,
): string | null {
  const normalized = normalizeConnectorSecretValue(value);
  const prefixHint = catalogEntry.requiredFields[0]?.prefixHint;
  if (!prefixHint || !normalized || normalized.startsWith(prefixHint)) {
    return null;
  }
  return `Usually starts with ${prefixHint}`;
}
