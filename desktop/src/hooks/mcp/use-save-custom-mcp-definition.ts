import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createCustomMcpDefinition,
  patchCustomMcpDefinition,
} from "@/lib/integrations/cloud/mcp_custom_definitions";
import type {
  CreateCustomMcpDefinitionRequest,
  PatchCustomMcpDefinitionRequest,
} from "@/lib/integrations/cloud/client";
import { mcpConnectorsKey } from "./query-keys";

export function useCreateCustomMcpDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomMcpDefinitionRequest) => createCustomMcpDefinition(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
    },
  });
}

export function usePatchCustomMcpDefinition(definitionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchCustomMcpDefinitionRequest) =>
      patchCustomMcpDefinition(definitionId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() });
    },
  });
}
