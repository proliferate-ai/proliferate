import type {
  PluginCatalogEntryView,
  PluginCatalogFieldView,
  PluginConnectionDraft,
  PluginInventoryItem,
  PluginSettings,
  PluginSettingsFieldView,
  PluginSettingValue,
  PluginSurfaceKind,
} from "./cloud-plugin-inventory-types";

export function createDefaultPluginDraft(
  item: PluginInventoryItem,
): PluginConnectionDraft {
  return {
    settings: normalizePluginSettings(item.entry, item.connection?.settings),
    secretFields: Object.fromEntries(
      getPluginSecretFields(item.entry).map((field) => [field.id, ""]),
    ),
  };
}

export function normalizePluginSettings(
  entry: PluginCatalogEntryView,
  raw: Record<string, unknown> | PluginSettings | undefined,
): PluginSettings | undefined {
  if (entry.settingsSchema.length === 0) {
    return undefined;
  }
  const source = raw ?? {};
  const normalized: PluginSettings = {};
  for (const field of entry.settingsSchema) {
    const value = normalizeSettingValue(field, source[field.id]);
    if (value !== undefined) {
      normalized[field.id] = value;
    } else if (field.defaultValue !== undefined && field.defaultValue !== null) {
      normalized[field.id] = field.defaultValue;
    }
  }
  return normalized;
}

export function pluginSettingsToCloud(
  entry: PluginCatalogEntryView,
  settings: PluginSettings | undefined,
): Record<string, unknown> | undefined {
  return normalizePluginSettings(entry, settings);
}

export function pluginSecretFieldsToCloud(
  entry: PluginCatalogEntryView,
  values: Record<string, string>,
): Record<string, string> {
  return normalizedPluginSecretFields(entry, values);
}

export function validatePluginSettings(
  entry: PluginCatalogEntryView,
  settings: PluginSettings | undefined,
): string | null {
  const normalized = normalizePluginSettings(entry, settings);
  for (const field of entry.settingsSchema) {
    const value = normalized?.[field.id];
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      if (field.required) {
        return `${field.label} is required.`;
      }
      continue;
    }
    const error = validateSettingValue(field, value);
    if (error) {
      return error;
    }
  }
  return null;
}

export function getPluginSecretFields(
  entry: PluginCatalogEntryView,
): readonly PluginCatalogFieldView[] {
  return entry.secretFields.length > 0 ? entry.secretFields : entry.requiredFields;
}

export function normalizePluginSecretValue(value: string): string {
  return value.trim();
}

export function validatePluginSecrets(
  entry: PluginCatalogEntryView,
  values: Record<string, string>,
): string | null {
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return null;
  }
  for (const field of getPluginSecretFields(entry)) {
    const normalized = normalizePluginSecretValue(values[field.id] ?? "");
    if (!normalized) {
      return `${field.label}: Enter a token.`;
    }
    if (/\s/u.test(normalized)) {
      return `${field.label}: Enter a single-line token.`;
    }
    if (normalized.length > 512) {
      return `${field.label}: Tokens must be 512 characters or fewer.`;
    }
  }
  return null;
}

export function normalizedPluginSecretFields(
  entry: PluginCatalogEntryView,
  values: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const field of getPluginSecretFields(entry)) {
    normalized[field.id] = normalizePluginSecretValue(values[field.id] ?? "");
  }
  return normalized;
}

export function pluginSupportsSurface(
  entry: PluginCatalogEntryView,
  surface: PluginSurfaceKind,
): boolean {
  if (entry.setupKind === "local_oauth") {
    return surface === "desktop";
  }
  if (entry.availability === "local_only") {
    return surface === "desktop";
  }
  return true;
}

export function pluginRequiresBrowserAuth(entry: PluginCatalogEntryView): boolean {
  return entry.transport === "http" && entry.authKind === "oauth";
}

function normalizeSettingValue(
  field: PluginSettingsFieldView,
  value: unknown,
): PluginSettingValue | undefined {
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
  field: PluginSettingsFieldView,
  value: PluginSettingValue,
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
  if (value.startsWith("https://")) {
    return true;
  }
  return value.startsWith("http://localhost")
    || value.startsWith("http://127.0.0.1")
    || value.startsWith("http://[::1]");
}
