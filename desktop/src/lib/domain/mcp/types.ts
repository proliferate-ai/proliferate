export type ConnectorCatalogId =
  | "github"
  | "gmail"
  | "google_calendar"
  | "context7"
  | "exa"
  | "brave_search"
  | "tavily"
  | "openweather"
  | "linear"
  | "supabase"
  | "notion"
  | "filesystem"
  | "playwright";

export type ConnectorAvailability = "universal" | "local_only" | "cloud_only";
export type ConnectorSyncState = "synced" | "degraded";

export interface ConnectorCatalogField {
  id: string;
  label: string;
  placeholder: string;
  helperText: string;
  getTokenInstructions: string;
  prefixHint?: string;
}

export type ConnectorHttpAuthStyle =
  | { kind: "bearer" }
  | { kind: "header"; headerName: string }
  | { kind: "query"; parameterName: string };

export type ConnectorArgTemplate =
  | { source: { kind: "static"; value: string } }
  | { source: { kind: "workspace_path" } };

export type ConnectorEnvTemplate =
  | { name: string; source: { kind: "static"; value: string } }
  | { name: string; source: { kind: "field"; fieldId: string } };

export type ConnectorIconId =
  | "brave"
  | "calendar"
  | "context7"
  | "filesystem"
  | "gmail"
  | "github"
  | "globe"
  | "linear"
  | "notion"
  | "openweather"
  | "playwright"
  | "search"
  | "supabase"
  | "sun"
  | "tavily"
  | "folder"
  | "terminal";

export interface SupabaseConnectorSettings {
  kind: "supabase";
  projectRef: string;
  readOnly: boolean;
}

export type ConnectorSettings = SupabaseConnectorSettings;

interface ConnectorCatalogEntryBase {
  id: ConnectorCatalogId;
  name: string;
  oneLiner: string;
  description: string;
  docsUrl: string;
  availability: ConnectorAvailability;
  cloudSecretSync: boolean;
  serverNameBase: string;
  iconId: ConnectorIconId;
  requiredFields: readonly ConnectorCatalogField[];
  capabilities: readonly string[];
}

export interface SecretHttpConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "http";
  authKind: "secret";
  authStyle: ConnectorHttpAuthStyle;
  authFieldId: string;
  url: string;
}

export interface OAuthHttpConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "http";
  authKind: "oauth";
  url: string;
}

export type HttpConnectorCatalogEntry =
  | SecretHttpConnectorCatalogEntry
  | OAuthHttpConnectorCatalogEntry;

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
  syncState: ConnectorSyncState;
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
  | (ConnectorLaunchResolutionWarningBase & { kind: "missing_stdio_command" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "workspace_path_unresolved" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "unsupported_target" });
