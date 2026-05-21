import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  SlackBotConfigResponse,
  SlackChannelsResponse,
  SlackConnectionValidationResponse,
  SlackDisconnectResponse,
  SlackOAuthStartOptions,
  SlackOAuthStartResponse,
  SlackRepoRoutingProfile,
  SlackRepoRoutingProfilesResponse,
  UpdateSlackBotConfigRequest,
  UpsertSlackRepoRoutingProfileRequest,
} from "../types/index.js";

export async function startSlackOAuth(
  options: SlackOAuthStartOptions,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackOAuthStartResponse> {
  return client.requestJson<SlackOAuthStartResponse>({
    method: "GET",
    path: "/v1/cloud/slack/oauth/start",
    query: { organizationId: options.organizationId },
  });
}

export async function getSlackBotConfig(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackBotConfigResponse> {
  return client.requestJson<SlackBotConfigResponse>({
    method: "GET",
    path: "/v1/cloud/slack/bot-config",
    query: { organizationId },
  });
}

export async function updateSlackBotConfig(
  organizationId: string,
  body: UpdateSlackBotConfigRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackBotConfigResponse> {
  return client.requestJson<SlackBotConfigResponse>({
    method: "PATCH",
    path: "/v1/cloud/slack/bot-config",
    query: { organizationId },
    body,
  });
}

export async function validateSlackConnection(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackConnectionValidationResponse> {
  return client.requestJson<SlackConnectionValidationResponse>({
    method: "POST",
    path: "/v1/cloud/slack/bot-config/validate-connection",
    query: { organizationId },
  });
}

export async function disconnectSlackWorkspace(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackDisconnectResponse> {
  return client.requestJson<SlackDisconnectResponse>({
    method: "POST",
    path: "/v1/cloud/slack/disconnect",
    query: { organizationId },
  });
}

export async function listSlackChannels(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackChannelsResponse> {
  return client.requestJson<SlackChannelsResponse>({
    method: "GET",
    path: "/v1/cloud/slack/channels",
    query: { organizationId },
  });
}

export async function listSlackRepoRoutingProfiles(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackRepoRoutingProfilesResponse> {
  return client.requestJson<SlackRepoRoutingProfilesResponse>({
    method: "GET",
    path: "/v1/cloud/slack/repo-routing-profiles",
    query: { organizationId },
  });
}

export async function upsertSlackRepoRoutingProfile(
  organizationId: string,
  body: UpsertSlackRepoRoutingProfileRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<SlackRepoRoutingProfilesResponse> {
  return client.requestJson<SlackRepoRoutingProfilesResponse>({
    method: "PUT",
    path: "/v1/cloud/slack/repo-routing-profiles",
    query: { organizationId },
    body,
  });
}
