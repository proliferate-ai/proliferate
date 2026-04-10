import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateConnectorSecret } from "@/lib/infra/mcp/persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { mcpConnectorsKey } from "./query-keys";

export function useUpdateConnectorSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      connectionId: string;
      catalogEntryId: string;
      secretValue: string;
    }) => updateConnectorSecret(input.connectionId, input.secretValue),
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
      trackProductEvent("connector_updated", {
        connector_id: variables.catalogEntryId,
        result: result.degraded ? "degraded" : "synced",
      });
      if (result.degraded) {
        trackProductEvent("connector_sync_degraded", {
          connector_id: variables.catalogEntryId,
        });
      }
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "update_connector_secret",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
        },
      });
    },
  });
}
