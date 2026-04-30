import type {
  ConnectorCatalogEntry,
  ConnectorSettingValue,
  ConnectorSettings,
  ConnectorSettingsField,
} from "@/lib/domain/mcp/types";

export function createDefaultConnectorSettings(
  entry: ConnectorCatalogEntry,
): ConnectorSettings | undefined {
  if (entry.settingsSchema.length === 0) {
    return undefined;
  }
  return normalizeConnectorSettings(entry, undefined);
}

export function normalizeConnectorSettings(
  entry: ConnectorCatalogEntry,
  raw: ConnectorSettings | Record<string, unknown> | undefined,
): ConnectorSettings {
  const source = raw ?? {};
  const normalized: ConnectorSettings = {};
  for (const field of entry.settingsSchema) {
    const rawValue = source[field.id];
    const value = normalizeSettingValue(field, rawValue);
    if (value !== undefined) {
      normalized[field.id] = value;
      continue;
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      normalized[field.id] = field.defaultValue;
    }
  }
  return normalized;
}

export function validateConnectorSettings(
  entry: ConnectorCatalogEntry,
  settings: ConnectorSettings | undefined,
): string | null {
  const normalized = normalizeConnectorSettings(entry, settings);
  for (const field of entry.settingsSchema) {
    const value = normalized[field.id];
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      if (field.required) {
        return `${field.label} is required.`;
      }
      continue;
    }
    const fieldError = validateSettingValue(field, value);
    if (fieldError) {
      return fieldError;
    }
  }
  return null;
}

export function connectorSettingsEqual(
  entry: ConnectorCatalogEntry,
  left: ConnectorSettings | undefined,
  right: ConnectorSettings | undefined,
): boolean {
  const normalizedLeft = normalizeConnectorSettings(entry, left);
  const normalizedRight = normalizeConnectorSettings(entry, right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function connectorSettingsToCloud(
  entry: ConnectorCatalogEntry,
  settings: ConnectorSettings | undefined,
): Record<string, unknown> | undefined {
  if (entry.settingsSchema.length === 0) {
    return undefined;
  }
  return normalizeConnectorSettings(entry, settings);
}

function normalizeSettingValue(
  field: ConnectorSettingsField,
  value: unknown,
): ConnectorSettingValue | undefined {
  if (field.kind === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 || field.required ? trimmed : undefined;
}

function validateSettingValue(
  field: ConnectorSettingsField,
  value: ConnectorSettingValue,
): string | null {
  if (field.kind === "boolean") {
    return typeof value === "boolean" ? null : `${field.label} must be true or false.`;
  }
  if (typeof value !== "string") {
    return `${field.label} must be text.`;
  }
  if (field.kind === "select") {
    const allowed = new Set(field.options.map((option) => option.value));
    return allowed.has(value) ? null : `Choose a valid ${field.label}.`;
  }
  if (field.kind === "url") {
    return isSafeUrl(value) ? null : `${field.label} must be an https URL.`;
  }
  return null;
}

function isSafeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") {
      return true;
    }
    return parsed.protocol === "http:"
      && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
