import type { CloudMcpCatalogEntry } from "@proliferate/cloud-sdk";

import type {
  CloudPluginPackageModel,
  PluginCatalogEntryView,
  PluginCatalogFieldView,
  PluginSettingsFieldView,
} from "./cloud-plugin-inventory-types";

export function catalogEntryView(
  entry: CloudMcpCatalogEntry,
  pluginPackage: CloudPluginPackageModel | undefined,
): PluginCatalogEntryView {
  return {
    id: entry.id,
    version: entry.version,
    name: entry.name,
    oneLiner: entry.oneLiner,
    description: entry.description,
    docsUrl: entry.docsUrl,
    availability: entry.availability,
    cloudSecretSync: entry.cloudSecretSync,
    setupKind: entry.setupKind ?? "none",
    transport: entry.transport,
    authKind: entry.authKind,
    url: entry.url,
    displayUrl: entry.displayUrl ?? entry.url,
    serverNameBase: entry.serverNameBase,
    iconId: entry.iconId,
    capabilities: entry.capabilities,
    oauthClientMode: entry.oauthClientMode ?? null,
    secretFields: (entry.secretFields ?? []).map(catalogFieldView),
    requiredFields: (entry.requiredFields ?? []).map(catalogFieldView),
    settingsSchema: (entry.settingsSchema ?? []).map(settingsFieldView),
    pluginPackage: pluginPackage
      ? {
          id: pluginPackage.id,
          version: pluginPackage.version,
          displayName: pluginPackage.displayName,
          description: pluginPackage.description,
          skills: (pluginPackage.skills ?? []).map((skill) => ({
            id: skill.id,
            displayName: skill.displayName,
            description: skill.description,
            defaultEnabled: skill.defaultEnabled,
          })),
        }
      : undefined,
  };
}

function catalogFieldView(
  field: NonNullable<CloudMcpCatalogEntry["secretFields"]>[number],
): PluginCatalogFieldView {
  return {
    id: field.id,
    label: field.label,
    placeholder: field.placeholder,
    helperText: field.helperText,
    getTokenInstructions: field.getTokenInstructions,
    prefixHint: field.prefixHint ?? undefined,
  };
}

function settingsFieldView(
  field: NonNullable<CloudMcpCatalogEntry["settingsSchema"]>[number],
): PluginSettingsFieldView {
  return {
    id: field.id,
    kind: field.kind,
    label: field.label,
    placeholder: field.placeholder ?? "",
    helperText: field.helperText ?? "",
    required: field.required,
    defaultValue: field.defaultValue ?? undefined,
    options: (field.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    })),
    affectsUrl: field.affectsUrl,
  };
}

export function isActiveCatalogEntry(entry: PluginCatalogEntryView): boolean {
  if (entry.transport === "http") {
    return entry.url.trim().length > 0;
  }
  return true;
}
