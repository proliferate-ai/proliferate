import { getConnectorSecretFields } from "@/lib/domain/mcp/catalog";
import type {
  ConnectorCatalogEntry,
  ConnectorCatalogId,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";

export type ConnectorSetupVariant =
  | "no_setup"
  | "local_oauth"
  | "api_key"
  | "oauth"
  | "oauth_structured";

export type ConnectorCardStatusIntent =
  | "connected"
  | "needs_token"
  | "needs_reconnect"
  | "off";

export interface ConnectorCardStatus {
  intent: ConnectorCardStatusIntent;
  label: string;
  actionable: boolean;
  tone: "neutral" | "muted" | "warning" | "error";
}

export type ConnectorModalTab = "configure" | "tools" | "about";

export type ConnectorConfigureFocus = "token" | "reconnect" | "sync" | null;

export type ConnectorCatalogModalState =
  | { kind: "connect"; entryId: ConnectorCatalogId; tab: ConnectorModalTab }
  | {
      kind: "manage";
      connectionId: string;
      tab: ConnectorModalTab;
      focus: ConnectorConfigureFocus;
    }
  | null;

export interface ConnectedCardModel {
  record: InstalledConnectorRecord;
  status: ConnectorCardStatus;
  variant: ConnectorSetupVariant;
}

export interface AvailableCardModel {
  entry: ConnectorCatalogEntry;
  variant: ConnectorSetupVariant;
}

export interface ResolvedConnectConnectorModal {
  kind: "connect";
  entry: ConnectorCatalogEntry;
  variant: ConnectorSetupVariant;
  tab: ConnectorModalTab;
}

export interface ResolvedManageConnectorModal {
  kind: "manage";
  record: InstalledConnectorRecord;
  variant: ConnectorSetupVariant;
  tab: ConnectorModalTab;
  focus: ConnectorConfigureFocus;
  status: ConnectorCardStatus;
}

export type ResolvedConnectorModal =
  | ResolvedConnectConnectorModal
  | ResolvedManageConnectorModal;

export function resolveConnectorVariant(entry: ConnectorCatalogEntry): ConnectorSetupVariant {
  if (entry.setupKind === "local_oauth") {
    return "local_oauth";
  }
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return entry.settingsSchema.length > 0 ? "oauth_structured" : "oauth";
  }
  if (getConnectorSecretFields(entry).length > 0) {
    return "api_key";
  }
  return "no_setup";
}

export function resolveConnectorStatus(record: InstalledConnectorRecord): ConnectorCardStatus {
  const isOAuth =
    record.catalogEntry.transport === "http" && record.catalogEntry.authKind === "oauth";
  const isLocalOAuth = record.catalogEntry.setupKind === "local_oauth";

  if (record.broken && (isOAuth || isLocalOAuth)) {
    return {
      intent: "needs_reconnect",
      label: "Needs reconnect",
      actionable: true,
      tone: "error",
    };
  }
  if (record.broken) {
    return {
      intent: "needs_token",
      label: "Needs token",
      actionable: true,
      tone: "error",
    };
  }
  if (!record.metadata.enabled) {
    return {
      intent: "off",
      label: "Off",
      actionable: false,
      tone: "muted",
    };
  }
  return {
    intent: "connected",
    label: "Connected",
    actionable: false,
    tone: "neutral",
  };
}

export function connectorFocusFromStatus(
  status: ConnectorCardStatus,
): ConnectorConfigureFocus {
  switch (status.intent) {
    case "needs_token":
      return "token";
    case "needs_reconnect":
      return "reconnect";
    default:
      return null;
  }
}

export function buildConnectedConnectorCards(
  installed: readonly InstalledConnectorRecord[],
  normalizedQuery: string,
): ConnectedCardModel[] {
  return installed
    .filter((record) => matchesQuery(record.catalogEntry, normalizedQuery))
    .map((record) => ({
      record,
      status: resolveConnectorStatus(record),
      variant: resolveConnectorVariant(record.catalogEntry),
    }));
}

export function buildAvailableConnectorCards(
  available: readonly ConnectorCatalogEntry[],
  normalizedQuery: string,
): AvailableCardModel[] {
  return available
    .filter((entry) => matchesQuery(entry, normalizedQuery))
    .map((entry) => ({
      entry,
      variant: resolveConnectorVariant(entry),
    }));
}

export function resolveConnectorModal(input: {
  available: readonly ConnectorCatalogEntry[];
  installed: readonly InstalledConnectorRecord[];
  modal: ConnectorCatalogModalState;
}): ResolvedConnectorModal | null {
  const modal = input.modal;
  if (!modal) {
    return null;
  }
  if (modal.kind === "connect") {
    const entry = input.available.find((candidate) => candidate.id === modal.entryId);
    if (!entry) {
      return null;
    }
    return {
      kind: "connect",
      entry,
      variant: resolveConnectorVariant(entry),
      tab: modal.tab,
    };
  }

  const record = input.installed.find(
    (candidate) => candidate.metadata.connectionId === modal.connectionId,
  );
  if (!record) {
    return null;
  }
  return {
    kind: "manage",
    record,
    variant: resolveConnectorVariant(record.catalogEntry),
    tab: modal.tab,
    focus: modal.focus,
    status: resolveConnectorStatus(record),
  };
}

function matchesQuery(entry: ConnectorCatalogEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return (
    entry.name.toLowerCase().includes(normalizedQuery)
    || entry.oneLiner.toLowerCase().includes(normalizedQuery)
    || entry.description.toLowerCase().includes(normalizedQuery)
  );
}
