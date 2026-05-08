import { useMutation } from "@tanstack/react-query";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  type DeleteConnectorMutationInput,
  useDeleteConnectorMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";

export function useDeleteConnector() {
  const deleteConnectorMutation = useDeleteConnectorMutation();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: (input: DeleteConnectorMutationInput) =>
      deleteConnectorMutation.mutateAsync(input),
    onSuccess: (_result, variables) => {
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
