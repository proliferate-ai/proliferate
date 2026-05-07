import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteConnector } from "@/lib/workflows/mcp/connector-persistence";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { mcpConnectorsKey } from "./query-keys";

export function useDeleteConnector() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: async (input: { connectionId: string; catalogEntryId: string }) => {
      await deleteConnector(input.connectionId);
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
      trackProductEvent("connector_deleted", {
        connector_id: variables.catalogEntryId,
      });
    },
    onError: (error, variables) => {
      captureTelemetryException(error, {
        tags: {
          action: "delete_connector",
          domain: "mcp_connectors",
        },
        extras: {
          catalogEntryId: variables.catalogEntryId,
        },
      });
    },
  });
}
