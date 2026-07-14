import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  GenerateSessionTitleRequest,
  GenerateSessionTitleResponse,
  GenerateWorkspaceNameRequest,
  GenerateWorkspaceNameResponse,
} from "../types/index.js";

export async function generateSessionTitle(
  promptText: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GenerateSessionTitleResponse> {
  const request: GenerateSessionTitleRequest = {
    promptText,
  };

  return (
    await client.POST("/v1/ai_magic/session-titles/generate", {
      body: request,
    })
  ).data!;
}

export async function generateWorkspaceName(
  promptText: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<GenerateWorkspaceNameResponse> {
  const request: GenerateWorkspaceNameRequest = {
    promptText,
  };

  return (
    await client.POST("/v1/ai_magic/workspace-names/generate", {
      body: request,
    })
  ).data!;
}
