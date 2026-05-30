import type {
  CloudMcpCatalogEntry,
  CloudMcpCatalogResponse,
  CloudMcpConnection,
  CloudPluginConfiguredItem,
  CloudSkillConfiguredItem,
} from "@proliferate/cloud-sdk";

type CloudPluginPackageModel = NonNullable<CloudMcpCatalogResponse["pluginPackages"]>[number];

export type PluginSurfaceKind = "desktop" | "web";

export type PluginConnectionStatusTone = "neutral" | "muted" | "warning" | "error";

export type PluginSetupVariant =
  | "api_key"
  | "local_oauth"
  | "no_setup"
  | "oauth"
  | "oauth_structured";

export type PluginSettingValue = string | boolean;

export type PluginSettings = Record<string, PluginSettingValue>;

export interface PluginCatalogFieldView {
  id: string;
  label: string;
  placeholder: string;
  helperText: string;
  getTokenInstructions: string;
  prefixHint?: string;
}

export interface PluginSettingsOptionView {
  value: string;
  label: string;
}

export interface PluginSettingsFieldView {
  id: string;
  kind: "string" | "boolean" | "select" | "url";
  label: string;
  placeholder: string;
  helperText: string;
  required: boolean;
  defaultValue?: string | boolean | null;
  options: readonly PluginSettingsOptionView[];
  affectsUrl: boolean;
}

export interface PluginPackageSkillView {
  id: string;
  displayName: string;
  description: string;
  defaultEnabled: boolean;
}

export interface PluginPackageView {
  id: string;
  version: string;
  displayName: string;
  description: string;
  skills: readonly PluginPackageSkillView[];
}

export interface PluginCatalogEntryView {
  id: string;
  version: number;
  name: string;
  oneLiner: string;
  description: string;
  docsUrl: string;
  availability: "universal" | "local_only" | "cloud_only";
  cloudSecretSync: boolean;
  setupKind: "none" | "local_oauth";
  transport: "http" | "stdio";
  authKind: "secret" | "oauth" | "none";
  url: string;
  displayUrl: string;
  serverNameBase: string;
  iconId: string;
  capabilities: readonly string[];
  oauthClientMode?: "dcr" | "static" | null;
  secretFields: readonly PluginCatalogFieldView[];
  requiredFields: readonly PluginCatalogFieldView[];
  settingsSchema: readonly PluginSettingsFieldView[];
  pluginPackage?: PluginPackageView;
}

export interface PluginConfiguredCapabilityView {
  kind: "mcp" | "plugin" | "skill";
  id: string;
  label: string;
  enabled: boolean;
  ownerScope: string;
  publicToOrg: boolean;
  publicOrganizationId?: string | null;
  publicStatus: string;
}

export interface PluginInventoryItem {
  id: string;
  state: "available" | "installed";
  entry: PluginCatalogEntryView;
  setupVariant: PluginSetupVariant;
  connection?: CloudMcpConnection;
  configuredPlugin?: CloudPluginConfiguredItem | null;
  configuredSkills: readonly CloudSkillConfiguredItem[];
  enabled: boolean;
  broken: boolean;
  statusLabel: string;
  statusTone: PluginConnectionStatusTone;
  statusActionLabel: string | null;
  unavailableReason: string | null;
  capabilitySummary: string;
  includesLabel: string;
  sharedLabel: string;
  sharedTone: PluginConnectionStatusTone;
  isFullyPublic: boolean;
  hasPublicItems: boolean;
}

export interface BuildCloudPluginInventoryInput {
  catalog: CloudMcpCatalogResponse;
  connections: readonly CloudMcpConnection[];
  configuredPlugins: readonly CloudPluginConfiguredItem[];
  configuredSkills: readonly CloudSkillConfiguredItem[];
  surface: PluginSurfaceKind;
  query?: string;
}

export interface PluginConnectionDraft {
  settings?: PluginSettings;
  secretFields: Record<string, string>;
}

export function buildCloudPluginInventory({
  catalog,
  connections,
  configuredPlugins,
  configuredSkills,
  surface,
  query,
}: BuildCloudPluginInventoryInput): PluginInventoryItem[] {
  const normalizedQuery = normalizeQuery(query);
  const packagesByCatalogEntryId = new Map(
    (catalog.pluginPackages ?? []).map((pluginPackage) => [
      pluginPackage.catalogEntryId,
      pluginPackage,
    ]),
  );
  const entries = catalog.entries
    .map((entry) => catalogEntryView(entry, packagesByCatalogEntryId.get(entry.id)))
    .filter(isActiveCatalogEntry);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const pluginsByPluginId = new Map(configuredPlugins.map((item) => [item.pluginId, item]));
  const skillsByPluginId = groupSkillsByPluginId(configuredSkills);
  const installed = connections
    .map((connection) => {
      const entry = entriesById.get(connection.catalogEntryId);
      if (!entry) {
        return null;
      }
      return installedItem({
        connection,
        entry,
        configuredPlugin: entry.pluginPackage
          ? pluginsByPluginId.get(entry.pluginPackage.id) ?? null
          : null,
        configuredSkills: entry.pluginPackage
          ? skillsByPluginId.get(entry.pluginPackage.id) ?? []
          : [],
        surface,
      });
    })
    .filter((item): item is PluginInventoryItem => item !== null);
  const installedCatalogEntryIds = new Set(installed.map((item) => item.entry.id));
  const available = entries
    .filter((entry) => !installedCatalogEntryIds.has(entry.id))
    .map((entry) => availableItem(entry, surface));

  return [...installed, ...available].filter((item) =>
    matchesInventoryQuery(item, normalizedQuery)
  );
}

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

function catalogEntryView(
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

function installedItem(input: {
  connection: CloudMcpConnection;
  entry: PluginCatalogEntryView;
  configuredPlugin: CloudPluginConfiguredItem | null;
  configuredSkills: readonly CloudSkillConfiguredItem[];
  surface: PluginSurfaceKind;
}): PluginInventoryItem {
  const status = installedStatus(input.connection, input.entry);
  const publicState = publicExposureState(
    configuredCapabilityItems(
      input.connection,
      input.entry,
      input.configuredPlugin,
      input.configuredSkills,
    ),
  );
  return {
    id: input.connection.connectionId,
    state: "installed",
    entry: input.entry,
    setupVariant: resolveSetupVariant(input.entry),
    connection: input.connection,
    configuredPlugin: input.configuredPlugin,
    configuredSkills: input.configuredSkills,
    enabled: input.connection.enabled,
    broken: input.connection.authStatus !== "ready",
    statusLabel: status.label,
    statusTone: status.tone,
    statusActionLabel: status.actionLabel,
    unavailableReason: unavailableReason(input.entry, input.surface),
    capabilitySummary: capabilitySummary(input.entry),
    includesLabel: includesLabel(input.entry),
    sharedLabel: publicState.label,
    sharedTone: publicState.tone,
    isFullyPublic: publicState.isFullyPublic,
    hasPublicItems: publicState.hasPublicItems,
  };
}

function availableItem(
  entry: PluginCatalogEntryView,
  surface: PluginSurfaceKind,
): PluginInventoryItem {
  return {
    id: entry.id,
    state: "available",
    entry,
    setupVariant: resolveSetupVariant(entry),
    configuredPlugin: null,
    configuredSkills: [],
    enabled: false,
    broken: false,
    statusLabel: unavailableReason(entry, surface) ?? "Not installed",
    statusTone: unavailableReason(entry, surface) ? "warning" : "muted",
    statusActionLabel: null,
    unavailableReason: unavailableReason(entry, surface),
    capabilitySummary: capabilitySummary(entry),
    includesLabel: includesLabel(entry),
    sharedLabel: "Private",
    sharedTone: "muted",
    isFullyPublic: false,
    hasPublicItems: false,
  };
}

function resolveSetupVariant(entry: PluginCatalogEntryView): PluginSetupVariant {
  if (entry.setupKind === "local_oauth") {
    return "local_oauth";
  }
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return entry.settingsSchema.length > 0 ? "oauth_structured" : "oauth";
  }
  if (getPluginSecretFields(entry).length > 0) {
    return "api_key";
  }
  return "no_setup";
}

function installedStatus(
  connection: CloudMcpConnection,
  entry: PluginCatalogEntryView,
): {
  label: string;
  tone: PluginConnectionStatusTone;
  actionLabel: string | null;
} {
  const usesReconnect = pluginRequiresBrowserAuth(entry) || entry.setupKind === "local_oauth";
  if (connection.authStatus !== "ready" && usesReconnect) {
    return { label: "Needs reconnect", tone: "error", actionLabel: "Reconnect" };
  }
  if (connection.authStatus !== "ready") {
    return { label: "Needs token", tone: "error", actionLabel: "Add token" };
  }
  if (!connection.enabled) {
    return { label: "Off", tone: "muted", actionLabel: null };
  }
  return { label: "Connected", tone: "neutral", actionLabel: null };
}

function configuredCapabilityItems(
  connection: CloudMcpConnection,
  entry: PluginCatalogEntryView,
  configuredPlugin: CloudPluginConfiguredItem | null,
  configuredSkills: readonly CloudSkillConfiguredItem[],
): PluginConfiguredCapabilityView[] {
  return [
    {
      kind: "mcp",
      id: connection.connectionId,
      label: connection.serverName || entry.serverNameBase,
      enabled: connection.enabled,
      ownerScope: connection.ownerScope,
      publicToOrg: connection.publicToOrg,
      publicOrganizationId: connection.publicOrganizationId ?? null,
      publicStatus: connection.publicStatus,
    },
    ...(configuredPlugin
      ? [{
          kind: "plugin" as const,
          id: configuredPlugin.id,
          label: entry.pluginPackage?.displayName ?? entry.name,
          enabled: configuredPlugin.enabled,
          ownerScope: configuredPlugin.ownerScope,
          publicToOrg: configuredPlugin.publicToOrg,
          publicOrganizationId: configuredPlugin.publicOrganizationId ?? null,
          publicStatus: configuredPlugin.publicStatus,
        }]
      : []),
    ...configuredSkills.map((skill) => ({
      kind: "skill" as const,
      id: skill.id,
      label:
        entry.pluginPackage?.skills.find((candidate) => candidate.id === skill.skillId)
          ?.displayName ?? skill.skillId,
      enabled: skill.enabled,
      ownerScope: skill.ownerScope,
      publicToOrg: skill.publicToOrg,
      publicOrganizationId: skill.publicOrganizationId ?? null,
      publicStatus: skill.publicStatus,
    })),
  ];
}

function publicExposureState(items: readonly PluginConfiguredCapabilityView[]): {
  label: string;
  tone: PluginConnectionStatusTone;
  isFullyPublic: boolean;
  hasPublicItems: boolean;
} {
  const publicItems = items.filter(isConfiguredCapabilityPublic);
  const blocked = items.filter((item) =>
    item.ownerScope !== "organization"
    && item.publicToOrg
    && item.publicStatus !== "public"
  );
  const isFullyPublic = items.length > 0 && publicItems.length === items.length;
  const hasPublicItems = publicItems.length > 0;
  if (blocked.length > 0) {
    return {
      label: "Share pending",
      tone: "warning",
      isFullyPublic,
      hasPublicItems,
    };
  }
  if (isFullyPublic) {
    return {
      label: "Shared public",
      tone: "neutral",
      isFullyPublic,
      hasPublicItems,
    };
  }
  if (hasPublicItems) {
    return {
      label: `${publicItems.length}/${items.length} shared`,
      tone: "warning",
      isFullyPublic,
      hasPublicItems,
    };
  }
  return {
    label: "Private",
    tone: "muted",
    isFullyPublic,
    hasPublicItems,
  };
}

function isConfiguredCapabilityPublic(item: PluginConfiguredCapabilityView): boolean {
  return item.ownerScope === "organization" || (item.publicToOrg && item.publicStatus === "public");
}

function capabilitySummary(entry: PluginCatalogEntryView): string {
  const skillCount = entry.pluginPackage?.skills.length ?? 0;
  return [
    "MCP",
    skillCount > 0 ? `${skillCount} ${skillCount === 1 ? "skill" : "skills"}` : null,
    authSummary(entry),
  ].filter(Boolean).join(" · ");
}

function includesLabel(entry: PluginCatalogEntryView): string {
  const skillCount = entry.pluginPackage?.skills.length ?? 0;
  return [
    "App",
    "1 MCP",
    skillCount > 0 ? `${skillCount} ${skillCount === 1 ? "skill" : "skills"}` : null,
  ].filter(Boolean).join(" + ");
}

function authSummary(entry: PluginCatalogEntryView): string {
  if (entry.setupKind === "local_oauth") {
    return "local auth";
  }
  if (entry.transport === "stdio") {
    return "local";
  }
  if (entry.authKind === "oauth") {
    return "OAuth";
  }
  if (entry.authKind === "secret" || entry.requiredFields.length > 0) {
    return "API key";
  }
  return "no setup";
}

function unavailableReason(
  entry: PluginCatalogEntryView,
  surface: PluginSurfaceKind,
): string | null {
  if (pluginSupportsSurface(entry, surface)) {
    return null;
  }
  if (surface === "web" && entry.setupKind === "local_oauth") {
    return "Requires Desktop";
  }
  if (surface === "web" && entry.availability === "local_only") {
    return "Desktop only";
  }
  return null;
}

function groupSkillsByPluginId(
  skills: readonly CloudSkillConfiguredItem[],
): Map<string, CloudSkillConfiguredItem[]> {
  const grouped = new Map<string, CloudSkillConfiguredItem[]>();
  for (const skill of skills) {
    if (!skill.pluginId) {
      continue;
    }
    const existing = grouped.get(skill.pluginId) ?? [];
    existing.push(skill);
    grouped.set(skill.pluginId, existing);
  }
  return grouped;
}

function isActiveCatalogEntry(entry: PluginCatalogEntryView): boolean {
  if (entry.transport === "http") {
    return entry.url.trim().length > 0;
  }
  return true;
}

function matchesInventoryQuery(
  item: PluginInventoryItem,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return (
    item.entry.name.toLowerCase().includes(normalizedQuery)
    || item.entry.oneLiner.toLowerCase().includes(normalizedQuery)
    || item.entry.description.toLowerCase().includes(normalizedQuery)
  );
}

function normalizeQuery(query: string | undefined): string {
  return query?.trim().toLowerCase() ?? "";
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
