import { getProliferateClient } from "./core.js";
import type {
  GenerateSessionTitleRequest,
  GenerateSessionTitleResponse,
  GenerateWorkspaceNameRequest,
  GenerateWorkspaceNameResponse,
} from "../types/index.js";

export async function generateSessionTitle(
  promptText: string,
): Promise<GenerateSessionTitleResponse> {
  const request: GenerateSessionTitleRequest = {
    promptText,
  };

  return (
    await getProliferateClient().POST("/v1/ai_magic/session-titles/generate", {
      body: request,
    })
  ).data!;
}

export async function generateWorkspaceName(
  promptText: string,
): Promise<GenerateWorkspaceNameResponse> {
  const request: GenerateWorkspaceNameRequest = {
    promptText,
  };

  return (
    await getProliferateClient().POST("/v1/ai_magic/workspace-names/generate", {
      body: request,
    })
  ).data!;
}
