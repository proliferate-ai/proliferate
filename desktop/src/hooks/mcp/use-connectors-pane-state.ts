import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectorCatalogEntry, ConnectorCatalogId, InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { trackConnectorConnectClicked } from "@/hooks/mcp/use-install-connector";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useConnectors } from "./use-connectors";
import { useConnectorSyncRetry } from "./use-connector-sync-retry";

const EMPTY_INSTALLED: InstalledConnectorRecord[] = [];
const EMPTY_AVAILABLE: readonly ConnectorCatalogEntry[] = [];

type ConnectorsPaneModalState =
  | { kind: "install"; catalogEntryId: ConnectorCatalogId }
  | { kind: "manage"; connectionId: string }
  | null;

export function useConnectorsPaneState() {
  const { data } = useConnectors();
  const [modal, setModal] = useState<ConnectorsPaneModalState>(null);
  const { retryPendingConnectorSync } = useConnectorSyncRetry();
  const retryPendingConnectorSyncRef = useRef(retryPendingConnectorSync.mutateAsync);

  useEffect(() => {
    retryPendingConnectorSyncRef.current = retryPendingConnectorSync.mutateAsync;
  }, [retryPendingConnectorSync.mutateAsync]);

  useEffect(() => {
    trackProductEvent("connectors_pane_viewed", undefined);
    void retryPendingConnectorSyncRef.current({ silent: true });
  }, []);

  const installed = data?.installed ?? EMPTY_INSTALLED;
  const available = data?.available ?? EMPTY_AVAILABLE;

  const installTarget = useMemo(() => {
    if (modal?.kind !== "install") {
      return null;
    }
    return available.find((entry) => entry.id === modal.catalogEntryId) ?? null;
  }, [available, modal]);

  const manageTarget = useMemo(() => {
    if (modal?.kind !== "manage") {
      return null;
    }
    return installed.find((record) => record.metadata.connectionId === modal.connectionId) ?? null;
  }, [installed, modal]);

  const openInstallModal = useCallback((catalogEntryId: ConnectorCatalogId) => {
    trackConnectorConnectClicked(catalogEntryId);
    setModal({ kind: "install", catalogEntryId });
  }, []);

  const openManageModal = useCallback((connectionId: string) => {
    setModal({ kind: "manage", connectionId });
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  return {
    available,
    closeModal,
    installTarget,
    installed,
    manageTarget,
    openInstallModal,
    openManageModal,
  };
}
