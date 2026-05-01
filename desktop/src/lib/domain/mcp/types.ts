export type ConnectorCatalogId = string;

export type ConnectorAvailability = "universal" | "local_only" | "cloud_only";
export type ConnectorSetupKind = "none" | "local_oauth";

export interface ConnectorCatalogField {
  id: string;
  label: string;
  placeholder: string;
  helperText: string;
  getTokenInstructions: string;
  prefixHint?: string;
}

export interface ConnectorSettingsOption {
  value: string;
  label: string;
}

export interface ConnectorSettingsField {
  id: string;
  kind: "string" | "boolean" | "select" | "url";
  label: string;
  placeholder: string;
  helperText: string;
  required: boolean;
  defaultValue?: string | boolean | null;
  options: readonly ConnectorSettingsOption[];
  affectsUrl: boolean;
}

export type ConnectorHttpAuthStyle =
  | { kind: "bearer" }
  | { kind: "header"; headerName: string }
  | { kind: "query"; parameterName: string };

export type ConnectorArgTemplate =
  | { source: { kind: "static"; value: string } }
  | { source: { kind: "workspace_path" } }
  | { source: { kind: "secret"; fieldId: string } }
  | { source: { kind: "setting"; fieldId: string } };

export type ConnectorEnvTemplate =
  | { name: string; source: { kind: "static"; value: string } }
  | { name: string; source: { kind: "secret"; fieldId: string } }
  | { name: string; source: { kind: "setting"; fieldId: string } };

export type ConnectorIconId = string;

export type ConnectorSettingValue = string | boolean;

export type ConnectorSettings = Record<string, ConnectorSettingValue>;

export type ConnectOAuthConnectorResult =
  | { kind: "completed" }
  | { kind: "canceled" };

interface ConnectorCatalogEntryBase {
  id: ConnectorCatalogId;
  name: string;
  oneLiner: string;
  description: string;
  docsUrl: string;
  availability: ConnectorAvailability;
  cloudSecretSync: boolean;
  setupKind: ConnectorSetupKind;
  serverNameBase: string;
  iconId: ConnectorIconId;
  displayUrl: string;
  oauthClientMode?: "dcr" | "static";
  secretFields: readonly ConnectorCatalogField[];
  requiredFields: readonly ConnectorCatalogField[];
  settingsSchema: readonly ConnectorSettingsField[];
  capabilities: readonly string[];
}

export interface SecretHttpConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "http";
  authKind: "secret";
  authStyle?: ConnectorHttpAuthStyle;
  authFieldId?: string;
  url: string;
}

export interface OAuthHttpConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "http";
  authKind: "oauth";
  url: string;
}

export interface NoAuthHttpConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "http";
  authKind: "none";
  url: string;
}

export type HttpConnectorCatalogEntry =
  | SecretHttpConnectorCatalogEntry
  | OAuthHttpConnectorCatalogEntry
  | NoAuthHttpConnectorCatalogEntry;

export interface StdioConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "stdio";
  command: string;
  args: readonly ConnectorArgTemplate[];
  env: readonly ConnectorEnvTemplate[];
}

export type ConnectorCatalogEntry =
  | HttpConnectorCatalogEntry
  | StdioConnectorCatalogEntry;

export interface SavedConnectorMetadata {
  connectionId: string;
  catalogEntryId: ConnectorCatalogId;
  enabled: boolean;
  serverName: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  settings?: ConnectorSettings;
}

export interface ConnectorDeleteTombstone {
  connectionId: string;
  catalogEntryId: ConnectorCatalogId;
  deletedAt: string;
  lastAttemptAt: string | null;
}

export interface PersistedConnectorState {
  connections: SavedConnectorMetadata[];
  pendingDeletes: ConnectorDeleteTombstone[];
}

export interface InstalledConnectorRecord {
  metadata: SavedConnectorMetadata;
  catalogEntry: ConnectorCatalogEntry;
  broken: boolean;
}

interface ConnectorLaunchResolutionWarningBase {
  connectionId: string;
  catalogEntryId: ConnectorCatalogId;
  connectorName: string;
}

export type ConnectorLaunchResolutionWarning =
  | (ConnectorLaunchResolutionWarningBase & { kind: "missing_secret" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "needs_reconnect" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "command_missing" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "workspace_path_unresolved" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "unsupported_target" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "invalid_settings" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "refresh_failed" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "resolver_error" });
