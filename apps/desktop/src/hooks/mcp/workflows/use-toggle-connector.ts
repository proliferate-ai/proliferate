import { useMutation } from "@tanstack/react-query";
import {
  captureTelemetryException,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import {
  type ToggleConnectorMutationInput,
  useToggleConnectorMutation,
} from "@/hooks/access/mcp/connectors/use-connector-mutations";

export function useToggleConnector() {
  const toggleConnectorMutation = useToggleConnectorMutation();

  return useMutation({
    meta: {
      telemetryHandled: true,
    },
    mutationFn: (input: ToggleConnectorMutationInput) =>
      toggleConnectorMutation.mutateAsync(input),
    onSuccess: (_result, variables) => {
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
