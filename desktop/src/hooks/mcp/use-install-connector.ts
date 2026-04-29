import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getConnectorCatalogEntry, getConnectorAuthStyleLabel } from "@/lib/domain/mcp/catalog";
import { classifyTelemetryFailure } from "@/lib/domain/telemetry/failures";
import { installConnector } from "@/lib/infra/mcp/persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { emitRuntimeInputSyncEvent } from "@/hooks/cloud/runtime-input-sync-events";
import { refreshMcpConnectorsQuery } from "./use-connectors";

export function useInstallConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: { catalogEntryId: string; secretValue: string }) => {
      return installConnector(input.catalogEntryId, input.secretValue);
    },
    onSuccess: async (result, variables) => {
      await refreshMcpConnectorsQuery(queryClient);
      trackProductEvent("connector_install_succeeded", {
        connector_id: variables.catalogEntryId,
        result: result.degraded ? "degraded" : "synced",
      });
      if (result.degraded) {
        trackProductEvent("connector_sync_degraded", {
          connector_id: variables.catalogEntryId,
        });
      }
      emitRuntimeInputSyncEvent({
        trigger: "mcp_mutation",
        descriptors: [{ kind: "mcp_api_key_replica" }],
      });
    },
    onError: (error, variables) => {
      trackProductEvent("connector_install_failed", {
        connector_id: variables.catalogEntryId,
        failure_kind: classifyTelemetryFailure(error),
      });
      captureTelemetryException(error, {
        tags: {
          action: "install_connector",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
        },
      });
    },
  });
}

export function trackConnectorConnectClicked(catalogEntryId: string) {
  const catalogEntry = getConnectorCatalogEntry(catalogEntryId);
  if (!catalogEntry) {
    return;
  }
  trackProductEvent("connector_connect_clicked", {
    connector_id: catalogEntry.id,
    auth_style: getConnectorAuthStyleLabel(catalogEntry),
    availability: catalogEntry.availability,
  });
}
