import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  ClaimWorkspaceRequest,
  ClaimWorkspaceResponse,
  DirectAccessTokenRequest,
  DirectAccessTokenResponse,
  RevokeClaimTokenResponse,
} from "../types/index.js";

export interface DirectAccessTokenOptions {
  clientKind?: string | null;
}

export async function claimCloudWorkspace(
  workspaceId: string,
  body: ClaimWorkspaceRequest = { sourceKind: "manual" },
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<ClaimWorkspaceResponse> {
  return (
    await client.POST("/v1/cloud/workspaces/{cloud_workspace_id}/claim", {
      params: { path: { cloud_workspace_id: workspaceId } },
      body,
    })
  ).data!;
}

export async function issueCloudWorkspaceDirectAccessToken(
  workspaceId: string,
  body: DirectAccessTokenRequest = {},
  options?: DirectAccessTokenOptions,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<DirectAccessTokenResponse> {
  return (
    await client.POST("/v1/cloud/workspaces/{cloud_workspace_id}/direct-access-token", {
      params: {
        path: { cloud_workspace_id: workspaceId },
        header: { "X-Client-Kind": options?.clientKind ?? undefined },
      },
      body,
    })
  ).data!;
}

export async function refreshCloudWorkspaceDirectAccessToken(
  workspaceId: string,
  body: DirectAccessTokenRequest = {},
  options?: DirectAccessTokenOptions,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<DirectAccessTokenResponse> {
  return (
    await client.POST(
      "/v1/cloud/workspaces/{cloud_workspace_id}/direct-access-token/refresh",
      {
        params: {
          path: { cloud_workspace_id: workspaceId },
          header: { "X-Client-Kind": options?.clientKind ?? undefined },
        },
        body,
      },
    )
  ).data!;
}

export async function revokeCloudWorkspaceDirectAccessToken(
  workspaceId: string,
  tokenId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<RevokeClaimTokenResponse> {
  return (
    await client.DELETE(
      "/v1/cloud/workspaces/{cloud_workspace_id}/direct-access-tokens/{token_id}",
      {
        params: { path: { cloud_workspace_id: workspaceId, token_id: tokenId } },
      },
    )
  ).data!;
}
