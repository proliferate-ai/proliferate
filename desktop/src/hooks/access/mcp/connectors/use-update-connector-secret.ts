import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConnectorSettings } from "@/lib/domain/mcp/types";
import { updateConnectorSecret } from "@/lib/workflows/mcp/connector-persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { refreshMcpConnectorsQuery } from "./use-connectors";

export function useUpdateConnectorSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: {
      connectionId: string;
      catalogEntryId: string;
      secretFields: Record<string, string>;
      settings?: ConnectorSettings;
    }) => updateConnectorSecret(input.connectionId, input.secretFields, input.settings),
    onSuccess: async (_result, variables) => {
      await refreshMcpConnectorsQuery(queryClient);
      trackProductEvent("connector_updated", {
        connector_id: variables.catalogEntryId,
        result: "synced",
      });
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
