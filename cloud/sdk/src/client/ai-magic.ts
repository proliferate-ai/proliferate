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

export async function generateCommitMessage(input: {
  diffText: string;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  branchName?: string | null;
}): Promise<GenerateCommitMessageResponse> {
  const request: GenerateCommitMessageRequest = {
    diffText: input.diffText,
    gitOwner: input.gitOwner ?? null,
    gitRepoName: input.gitRepoName ?? null,
    branchName: input.branchName ?? null,
  };

  return (
    await getProliferateClient().POST("/v1/ai_magic/commit-messages/generate", {
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
