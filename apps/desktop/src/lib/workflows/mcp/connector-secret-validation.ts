import {
  getConnectorSecretFields,
} from "@/lib/domain/mcp/catalog";
import {
  normalizeConnectorSecretValue,
  validateConnectorSecretValue,
} from "@/lib/domain/mcp/validation";
import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";

export function normalizeConnectorSecretValues(
  catalogEntry: ConnectorCatalogEntry,
  values: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const field of getConnectorSecretFields(catalogEntry)) {
    normalized[field.id] = normalizeConnectorSecretValue(values[field.id] ?? "");
  }
  return normalized;
}

export function validateConnectorSecretValues(
  catalogEntry: ConnectorCatalogEntry,
  values: Record<string, string>,
): void {
  for (const field of getConnectorSecretFields(catalogEntry)) {
    const validationError = validateConnectorSecretValue(values[field.id] ?? "");
    if (validationError) {
      throw new Error(`${field.label}: ${validationError}`);
    }
  }
}
