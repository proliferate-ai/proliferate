import { getProliferateClient } from "./core.js";
import type {
  GenerateCommitMessageRequest,
  GenerateCommitMessageResponse,
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

export async function generateCommitMessage(opts: {
  diffStat: string;
  diffExcerpt: string;
  branchName?: string;
}): Promise<GenerateCommitMessageResponse> {
  const request: GenerateCommitMessageRequest = {
    diffStat: opts.diffStat,
    diffExcerpt: opts.diffExcerpt,
    ...(opts.branchName != null ? { branchName: opts.branchName } : {}),
  };

  return (
    await getProliferateClient().POST(
      "/v1/ai_magic/commit-messages/generate",
      {
        body: request,
      },
    )
  ).data!;
}
