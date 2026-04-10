export type ConnectorCatalogId =
  | "github"
  | "context7"
  | "brave_search"
  | "tavily"
  | "openweather"
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
  | "github"
  | "globe"
  | "search"
  | "sun"
  | "folder"
  | "terminal";

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
}

export interface HttpConnectorCatalogEntry extends ConnectorCatalogEntryBase {
  transport: "http";
  authStyle: ConnectorHttpAuthStyle;
  authFieldId: string;
  url: string;
}

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
  | (ConnectorLaunchResolutionWarningBase & { kind: "missing_stdio_command" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "workspace_path_unresolved" })
  | (ConnectorLaunchResolutionWarningBase & { kind: "unsupported_target" });
