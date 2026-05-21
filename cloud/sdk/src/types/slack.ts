export type SlackWorkspaceConnectionStatus =
  | "active"
  | "reauth_required"
  | "revoked";

export type SlackBotRepoMode = "fixed" | "auto";

export interface SlackWorkspaceConnection {
  id: string;
  organizationId: string;
  slackTeamId: string;
  slackTeamName: string;
  slackBotUserId: string;
  botScopes: string;
  status: SlackWorkspaceConnectionStatus;
  installedByUserId: string;
  installedByDisplayName?: string | null;
  installedByEmail?: string | null;
  installedAt: string;
  lastValidatedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlackBotConfig {
  id: string;
  organizationId: string;
  slackWorkspaceConnectionId: string;
  enabled: boolean;
  repoMode: SlackBotRepoMode;
  fixedCloudRepoConfigId?: string | null;
  allowedCloudRepoConfigIds: string[];
  defaultAgentKind?: string | null;
  defaultAgentRunConfigId?: string | null;
  allowedSlackChannelIds: string[];
  ackMessageTemplate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlackBotConfigResponse {
  connection: SlackWorkspaceConnection | null;
  config: SlackBotConfig | null;
}

export interface UpdateSlackBotConfigRequest {
  enabled?: boolean | null;
  repoMode?: SlackBotRepoMode | null;
  fixedCloudRepoConfigId?: string | null;
  allowedCloudRepoConfigIds?: string[] | null;
  defaultAgentKind?: string | null;
  defaultAgentRunConfigId?: string | null;
  allowedSlackChannelIds?: string[] | null;
  ackMessageTemplate?: string | null;
}

export interface SlackConnectionValidationResponse {
  ok: boolean;
  status: string;
  teamName?: string | null;
  errorCode?: string | null;
}

export interface SlackDisconnectResponse {
  connection: SlackWorkspaceConnection | null;
}

export interface SlackOAuthStartUrlOptions {
  organizationId: string;
  returnTo?: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  isMember?: boolean | null;
}

export interface SlackChannelsResponse {
  channels: SlackChannel[];
}

export interface SlackRepoRoutingProfile {
  id: string;
  cloudRepoConfigId: string;
  organizationId: string;
  gitOwner?: string | null;
  gitRepoName?: string | null;
  displayName?: string | null;
  description?: string | null;
  readmeSummary?: string | null;
  languages: string[];
  topics: string[];
  cachedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlackRepoRoutingProfilesResponse {
  profiles: SlackRepoRoutingProfile[];
}

export interface UpsertSlackRepoRoutingProfileRequest {
  cloudRepoConfigId: string;
  displayName?: string | null;
  description?: string | null;
}
