/**
 * Integrations module exports.
 */

export * from "./service";
export * from "./mapper";

// Token resolution
export {
	getToken,
	resolveTokens,
	getEnvVarName,
	getIntegrationsForTokens,
	type IntegrationForToken,
	type TokenResult,
	type TokenError,
	type ResolveTokensResult,
} from "./tokens";

// GitHub App utilities
export { getInstallationToken } from "./github-app";

// Re-export types from db.ts
export type {
	GitHubAppIntegrationRow,
	GitHubIntegrationRow,
	IntegrationRow,
	IntegrationWithCreatorRow,
	RepoConnectionIntegrationRow,
	SlackInstallationRow,
	SlackConversationRow,
	RepoConnectionRow,
	UpsertGitHubAppInstallationInput,
	UserRow,
	OrganizationRow,
} from "./db";

// DB functions needed by sessions-create
export {
	getRepoConnectionsWithIntegrations,
	findByIdAndOrg,
	findActiveGitHubApp,
	findActiveByIntegrationId,
	findActiveNangoGitHub,
} from "./db";

// DB functions needed by repos router (available handler)
export {
	findActiveIntegrationForRepos,
	findFirstActiveGitHubAppForRepos,
	findFirstActiveNangoGitHubForRepos,
} from "./db";

// DB functions needed by GitHub App webhook handler
export { findActiveByGitHubInstallationId, updateStatusByGitHubInstallationId } from "./db";

// DB functions needed by Nango webhook handler
export { findByConnectionIdAndProvider, updateStatus } from "./db";

// DB functions needed by SlackClient
export { getSlackInstallationBotToken } from "./db";

// DB functions needed by notification dispatch
export { getSlackInstallationForNotifications } from "./db";

// DB functions needed for notification workspace selector
export { listActiveSlackInstallations } from "./db";
