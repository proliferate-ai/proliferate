import { useMutation } from "@tanstack/react-query";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  type UpdateConnectorSecretMutationInput,
  useUpdateConnectorSecretMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";

export function useUpdateConnectorSecret() {
  const updateConnectorSecretMutation = useUpdateConnectorSecretMutation();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: (input: UpdateConnectorSecretMutationInput) =>
      updateConnectorSecretMutation.mutateAsync(input),
    onSuccess: (_result, variables) => {
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
