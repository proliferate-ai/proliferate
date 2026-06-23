import type {
  CloudMcpCatalogResponse,
  CloudMcpConnection,
  CloudOrganizationIntegrationPolicyResponse,
  CloudPluginConfiguredItem,
  CloudSkillConfiguredItem,
} from "@proliferate/cloud-sdk";

export type CloudPluginPackageModel = NonNullable<CloudMcpCatalogResponse["pluginPackages"]>[number];

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
  integrationPolicy?: CloudOrganizationIntegrationPolicyResponse | null;
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
