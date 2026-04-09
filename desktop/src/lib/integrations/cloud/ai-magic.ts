import { getProliferateClient } from "./client";
import type {
  GenerateSessionTitleRequest,
  GenerateSessionTitleResponse,
} from "./client";

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
