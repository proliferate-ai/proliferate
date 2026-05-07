import { getProliferateClient } from "./client";
import type {
  CreateCustomMcpDefinitionRequest,
  CustomMcpDefinition,
  CustomMcpDefinitionsResponse,
  PatchCustomMcpDefinitionRequest,
} from "./client";

export async function listCustomMcpDefinitions(): Promise<CustomMcpDefinitionsResponse> {
  return (await getProliferateClient().GET("/v1/cloud/mcp/custom-definitions")).data!;
}

export async function createCustomMcpDefinition(
  body: CreateCustomMcpDefinitionRequest,
): Promise<CustomMcpDefinition> {
  return (await getProliferateClient().POST("/v1/cloud/mcp/custom-definitions", {
    body,
  })).data!;
}

export async function patchCustomMcpDefinition(
  definitionId: string,
  body: PatchCustomMcpDefinitionRequest,
): Promise<CustomMcpDefinition> {
  return (await getProliferateClient().PATCH(
    "/v1/cloud/mcp/custom-definitions/{definition_id}",
    {
      params: { path: { definition_id: definitionId } },
      body,
    },
  )).data!;
}

export async function deleteCustomMcpDefinition(definitionId: string): Promise<void> {
  await getProliferateClient().DELETE("/v1/cloud/mcp/custom-definitions/{definition_id}", {
    params: { path: { definition_id: definitionId } },
  });
}
