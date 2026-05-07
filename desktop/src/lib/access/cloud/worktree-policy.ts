import {
  getProliferateClient,
  type CloudWorktreeRetentionPolicyRequest,
  type CloudWorktreeRetentionPolicyResponse,
} from "./client";

export async function getCloudWorktreeRetentionPolicy(): Promise<CloudWorktreeRetentionPolicyResponse> {
  return (
    await getProliferateClient().GET("/v1/cloud/worktree-retention-policy")
  ).data!;
}

export async function putCloudWorktreeRetentionPolicy(
  input: CloudWorktreeRetentionPolicyRequest,
): Promise<CloudWorktreeRetentionPolicyResponse> {
  return (
    await getProliferateClient().PUT("/v1/cloud/worktree-retention-policy", {
      body: input,
    })
  ).data!;
}
