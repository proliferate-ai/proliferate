import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setConnectorEnabled } from "@/lib/infra/mcp/persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { mcpConnectorsKey } from "./query-keys";

export function useToggleConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      connectionId: string;
      catalogEntryId: string;
      enabled: boolean;
    }) => setConnectorEnabled(input.connectionId, input.enabled),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
      trackProductEvent("connector_toggled", {
        connector_id: variables.catalogEntryId,
        enabled: variables.enabled,
      });
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "toggle_connector",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
          enabled: variables.enabled,
        },
      });
    },
  });
}
