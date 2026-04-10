export type ConnectorCatalogId =
  | "github"
  | "context7"
  | "brave_search"
  | "tavily"
  | "openweather";

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

export type ConnectorAuthStyle =
  | { kind: "bearer" }
  | { kind: "header"; headerName: string }
  | { kind: "query"; parameterName: string };

export type ConnectorIconId = "github" | "globe" | "search" | "sun";

export interface ConnectorCatalogEntry {
  id: ConnectorCatalogId;
  name: string;
  oneLiner: string;
  description: string;
  docsUrl: string;
  availability: ConnectorAvailability;
  authStyle: ConnectorAuthStyle;
  authFieldId: string;
  mcpServerUrl: string;
  serverNameBase: string;
  iconId: ConnectorIconId;
  requiredFields: readonly [ConnectorCatalogField, ...ConnectorCatalogField[]];
}

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

export interface ConnectorLaunchResolutionWarning {
  kind: "missing_secret";
  connectionId: string;
  catalogEntryId: ConnectorCatalogId;
  connectorName: string;
}
