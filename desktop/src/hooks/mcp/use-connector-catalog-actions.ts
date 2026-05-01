import { useCallback, useMemo, useState } from "react";
import { useConnectOAuthConnector } from "@/hooks/mcp/use-connect-oauth-connector";
import { useDeleteConnector } from "@/hooks/mcp/use-delete-connector";
import { useInstallConnector } from "@/hooks/mcp/use-install-connector";
import { useInstalledConnectorActions } from "@/hooks/mcp/use-installed-connector-actions";
import { useReconnectOAuthConnector } from "@/hooks/mcp/use-reconnect-oauth-connector";
import { useUpdateConnectorSecret } from "@/hooks/mcp/use-update-connector-secret";
import type {
  ConnectorCatalogEntry,
  ConnectorSettings,
  ConnectOAuthConnectorResult,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";

type ConnectorDetailCallbacks = {
  onCancelOAuth: () => Promise<void>;
  onConnectOAuth: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onDelete: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
  ) => Promise<void>;
  onInstallSecret: (
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretFields: Record<string, string>,
    settings?: ConnectorSettings,
  ) => Promise<void>;
  onReconnect: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    settings?: ConnectorSettings,
  ) => Promise<ConnectOAuthConnectorResult>;
  onUpdateSecret: (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
    secretFields: Record<string, string>,
    settings?: ConnectorSettings,
  ) => Promise<void>;
};

export function useConnectorCatalogActions({
  closeModal,
}: {
  closeModal: () => void;
}) {
  const installedConnectorActions = useInstalledConnectorActions();
  const installMutation = useInstallConnector();
  const connectOAuthMutation = useConnectOAuthConnector();
  const reconnectOAuthMutation = useReconnectOAuthConnector();
  const updateSecretMutation = useUpdateConnectorSecret();
  const deleteMutation = useDeleteConnector();
  const [deleteTarget, setDeleteTarget] = useState<InstalledConnectorRecord | null>(null);

  const detailCallbacks = useMemo<ConnectorDetailCallbacks>(() => ({
    onCancelOAuth: async () => {
      await connectOAuthMutation.cancelPendingConnection();
      await reconnectOAuthMutation.cancelPendingConnection();
    },
    onConnectOAuth: (catalogEntryId, settings) =>
      connectOAuthMutation.mutateAsync({ catalogEntryId, settings }),
    onDelete: async (connectionId, catalogEntryId) => {
      await deleteMutation.mutateAsync({ connectionId, catalogEntryId });
      closeModal();
    },
    onInstallSecret: async (catalogEntryId, secretFields, settings) => {
      await installMutation.mutateAsync({ catalogEntryId, secretFields, settings });
    },
    onReconnect: (connectionId, catalogEntryId, settings) =>
      reconnectOAuthMutation.mutateAsync({
        connectionId,
        catalogEntryId,
        settings,
      }),
    onUpdateSecret: async (connectionId, catalogEntryId, secretFields, settings) => {
      await updateSecretMutation.mutateAsync({
        connectionId,
        catalogEntryId,
        secretFields,
        settings,
      });
    },
  }), [
    closeModal,
    connectOAuthMutation,
    deleteMutation,
    installMutation,
    reconnectOAuthMutation,
    updateSecretMutation,
  ]);

  const requestDelete = useCallback((record: InstalledConnectorRecord) => {
    setDeleteTarget(record);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDelete = useCallback(async (
    connectionId: string,
    catalogEntryId: ConnectorCatalogEntry["id"],
  ) => {
    await deleteMutation.mutateAsync({ connectionId, catalogEntryId });
    setDeleteTarget(null);
  }, [deleteMutation]);

  return {
    installedConnectorActions,
    detailCallbacks,
    deleteTarget,
    requestDelete,
    closeDeleteDialog,
    confirmDelete,
  };
}
