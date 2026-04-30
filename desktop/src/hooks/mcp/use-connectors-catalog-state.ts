import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConnectorCatalogEntry,
  ConnectorCatalogId,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import { trackConnectorConnectClicked } from "@/hooks/mcp/use-install-connector";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useConnectors } from "./use-connectors";

const EMPTY_INSTALLED: InstalledConnectorRecord[] = [];
const EMPTY_AVAILABLE: readonly ConnectorCatalogEntry[] = [];

export type ConnectorSetupVariant =
  | "no_setup"
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

export type ConnectorModalIntent =
  | {
      kind: "connect";
      entryId: ConnectorCatalogId;
      tab: ConnectorModalTab;
    }
  | {
      kind: "manage";
      connectionId: string;
      tab: ConnectorModalTab;
      focus: ConnectorConfigureFocus;
    };

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
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return entry.id === "supabase" ? "oauth_structured" : "oauth";
  }
  if (entry.requiredFields.length > 0) {
    return "api_key";
  }
  return "no_setup";
}

export function resolveConnectorStatus(record: InstalledConnectorRecord): ConnectorCardStatus {
  const isOAuth =
    record.catalogEntry.transport === "http" && record.catalogEntry.authKind === "oauth";

  if (record.broken && isOAuth) {
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
  if (isOAuth) {
    return {
      intent: "connected",
      label: "Connected",
      actionable: false,
      tone: "neutral",
    };
  }
  return {
    intent: "connected",
    label: "Connected",
    actionable: false,
    tone: "neutral",
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

function focusFromStatus(status: ConnectorCardStatus): ConnectorConfigureFocus {
  switch (status.intent) {
    case "needs_token":
      return "token";
    case "needs_reconnect":
      return "reconnect";
    default:
      return null;
  }
}

type InternalModalState =
  | { kind: "connect"; entryId: ConnectorCatalogId; tab: ConnectorModalTab }
  | {
      kind: "manage";
      connectionId: string;
      tab: ConnectorModalTab;
      focus: ConnectorConfigureFocus;
    }
  | null;

export function useConnectorsCatalogState() {
  const { data } = useConnectors();
  const [searchQuery, setSearchQuery] = useState("");
  const [modal, setModal] = useState<InternalModalState>(null);

  useEffect(() => {
    trackProductEvent("connectors_pane_viewed", undefined);
  }, []);

  const installed = data?.installed ?? EMPTY_INSTALLED;
  const available = data?.available ?? EMPTY_AVAILABLE;

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const connected = useMemo<ConnectedCardModel[]>(() => {
    return installed
      .filter((record) => matchesQuery(record.catalogEntry, normalizedQuery))
      .map((record) => ({
        record,
        status: resolveConnectorStatus(record),
        variant: resolveConnectorVariant(record.catalogEntry),
      }));
  }, [installed, normalizedQuery]);

  const availableCards = useMemo<AvailableCardModel[]>(() => {
    return available
      .filter((entry) => matchesQuery(entry, normalizedQuery))
      .map((entry) => ({
        entry,
        variant: resolveConnectorVariant(entry),
      }));
  }, [available, normalizedQuery]);

  const isSearching = normalizedQuery.length > 0;
  const firstRunEmpty =
    !isSearching && installed.length === 0;
  const searchEmpty =
    isSearching && connected.length === 0 && availableCards.length === 0;

  const resolvedModal = useMemo<ResolvedConnectorModal | null>(() => {
    if (!modal) {
      return null;
    }
    if (modal.kind === "connect") {
      const entry = available.find((candidate) => candidate.id === modal.entryId);
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
    const record = installed.find(
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
  }, [available, installed, modal]);

  const openConnect = useCallback((entryId: ConnectorCatalogId) => {
    trackConnectorConnectClicked(entryId);
    setModal({ kind: "connect", entryId, tab: "configure" });
  }, []);

  const openManage = useCallback((connectionId: string) => {
    setModal({ kind: "manage", connectionId, tab: "configure", focus: null });
  }, []);

  const openRecovery = useCallback((record: InstalledConnectorRecord) => {
    const status = resolveConnectorStatus(record);
    setModal({
      kind: "manage",
      connectionId: record.metadata.connectionId,
      tab: "configure",
      focus: focusFromStatus(status),
    });
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  const setActiveTab = useCallback((tab: ConnectorModalTab) => {
    setModal((current) => {
      if (!current) {
        return current;
      }
      return { ...current, tab };
    });
  }, []);

  return {
    availableCards,
    closeModal,
    connected,
    firstRunEmpty,
    isSearching,
    modal: resolvedModal,
    openConnect,
    openManage,
    openRecovery,
    searchEmpty,
    searchQuery,
    setActiveTab,
    setSearchQuery,
  };
}
