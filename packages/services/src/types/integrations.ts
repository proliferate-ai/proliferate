/**
 * Integrations module types.
 *
 * Re-exports DB row types from db.ts for backwards compatibility.
 */

// Re-export all types from db.ts
export type {
	IntegrationRow,
	IntegrationWithCreatorRow,
	SlackInstallationRow,
	SlackConversationRow,
	RepoConnectionRow,
	UserRow,
	OrganizationRow,
	RepoConnectionIntegrationRow,
	GitHubIntegrationRow,
	UpsertGitHubAppInstallationInput,
	GitHubAppIntegrationRow,
} from "../integrations/db";
