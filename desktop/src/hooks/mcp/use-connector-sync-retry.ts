import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getConnectorCatalogEntry } from "@/lib/domain/mcp/catalog";
import { retryConnectorSync, retryPendingConnectorSync } from "@/lib/infra/mcp/sync";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useToastStore } from "@/stores/toast/toast-store";
import { mcpConnectorsKey } from "./query-keys";

function connectorLabel(catalogEntryId: string): string {
  return getConnectorCatalogEntry(catalogEntryId)?.name ?? "Connector";
}

export function useConnectorSyncRetry() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);

  const retryOneMutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      connectionId: string;
      catalogEntryId: string;
      silent?: boolean;
    }) => {
      trackProductEvent("connector_sync_retry_clicked", {
        connector_id: input.catalogEntryId,
      });
      const recovered = await retryConnectorSync(input.connectionId);
      return { ...input, recovered };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
      if (result.recovered) {
        trackProductEvent("connector_sync_recovered", {
          connector_id: result.catalogEntryId,
        });
        if (!result.silent) {
          showToast(`${connectorLabel(result.catalogEntryId)} sync is up to date.`, "info");
        }
        return;
      }
      if (!result.silent) {
        showToast(`Couldn't sync ${connectorLabel(result.catalogEntryId)}. We'll retry again later.`);
      }
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "retry_connector_sync",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
          silent: variables.silent ?? false,
        },
      });
    },
  });

  const retryPendingMutation = useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input?: { silent?: boolean }) => {
      const recoveredAny = await retryPendingConnectorSync();
      return { recoveredAny, silent: input?.silent ?? false };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
      if (!result.recoveredAny && !result.silent) {
        showToast("Couldn't sync connectors. We'll retry again later.");
      }
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "retry_pending_connector_sync",
          domain: "mcp_connectors",
        },
        extras: {
          silent: variables?.silent ?? false,
        },
      });
    },
  });

  return {
    retryConnectorSync: retryOneMutation,
    retryPendingConnectorSync: retryPendingMutation,
  };
}
