import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  CloudWorktreeRetentionPolicyRequest,
  CloudWorktreeRetentionPolicyResponse,
} from "../types/index.js";

export async function getCloudWorktreeRetentionPolicy(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorktreeRetentionPolicyResponse> {
  return (
    await client.GET("/v1/cloud/worktree-retention-policy")
  ).data!;
}

export async function putCloudWorktreeRetentionPolicy(
  input: CloudWorktreeRetentionPolicyRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<CloudWorktreeRetentionPolicyResponse> {
  return (
    await client.PUT("/v1/cloud/worktree-retention-policy", {
      body: input,
    })
  ).data!;
}
