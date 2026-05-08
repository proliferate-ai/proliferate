import { useCallback, useMemo, useState } from "react";
import {
  buildAvailableConnectorCards,
  buildConnectedConnectorCards,
  connectorFocusFromStatus,
  type ConnectorCatalogModalState,
  type ConnectorModalTab,
  resolveConnectorModal,
  resolveConnectorStatus,
} from "@/lib/domain/mcp/connector-catalog-view-model";
import type {
  ConnectorCatalogEntry,
  ConnectorCatalogId,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import { useConnectors } from "@/hooks/access/mcp/connectors/use-connectors";
import { useConnectorsCatalogViewTelemetry } from "@/hooks/mcp/lifecycle/use-connectors-catalog-view-telemetry";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";

const EMPTY_INSTALLED: InstalledConnectorRecord[] = [];
const EMPTY_AVAILABLE: readonly ConnectorCatalogEntry[] = [];

// Owns connector catalog search/modal UI state. Does not own connector mutations.
export function useConnectorsCatalogState() {
  const connectorsQuery = useConnectors();
  const [searchQuery, setSearchQuery] = useState("");
  const [modal, setModal] = useState<ConnectorCatalogModalState>(null);

  useConnectorsCatalogViewTelemetry();

  const installed = connectorsQuery.data?.installed ?? EMPTY_INSTALLED;
  const available = connectorsQuery.data?.available ?? EMPTY_AVAILABLE;

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const connected = useMemo(
    () => buildConnectedConnectorCards(installed, normalizedQuery),
    [installed, normalizedQuery],
  );

  const availableCards = useMemo(
    () => buildAvailableConnectorCards(available, normalizedQuery),
    [available, normalizedQuery],
  );

  const isSearching = normalizedQuery.length > 0;
  const firstRunEmpty =
    !isSearching && installed.length === 0;
  const searchEmpty =
    isSearching && connected.length === 0 && availableCards.length === 0;

  const resolvedModal = useMemo(
    () => resolveConnectorModal({ available, installed, modal }),
    [available, installed, modal],
  );

  const openConnect = useCallback((entryId: ConnectorCatalogId) => {
    trackProductEvent("connector_connect_clicked", {
      connector_id: entryId,
      auth_style: "cloud",
      availability: "cloud",
    });
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
      focus: connectorFocusFromStatus(status),
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

  const retryLoad = useCallback(() => {
    void connectorsQuery.refetch();
  }, [connectorsQuery.refetch]);

  return {
    availableCards,
    closeModal,
    connected,
    firstRunEmpty,
    isSearching,
    isLoading: connectorsQuery.isLoading,
    loadError: connectorsQuery.error instanceof Error
      ? connectorsQuery.error.message
      : connectorsQuery.error
        ? "Couldn't load integrations."
        : null,
    modal: resolvedModal,
    openConnect,
    openManage,
    openRecovery,
    retryLoad,
    searchEmpty,
    searchQuery,
    setActiveTab,
    setSearchQuery,
  };
}
