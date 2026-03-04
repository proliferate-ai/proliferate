import "server-only";
/**
 * GitHub Token Abstraction
 *
 * Provides token/repo access via GitHub App installation tokens.
 */

import { getInstallationToken, listInstallationRepos } from "@/lib/integrations/github-app";

export interface GitHubIntegration {
	id: string;
	githubInstallationId?: number | string | null;
	connectionId: string | null;
	provider?: string;
}

/**
 * Get a GitHub access token for an integration.
 */
export async function getGitHubTokenForIntegration(
	integration: GitHubIntegration,
): Promise<string> {
	if (integration.githubInstallationId) {
		return getInstallationToken(String(integration.githubInstallationId));
	}
	throw new Error("No GitHub App installation ID available for integration");
}

/**
 * List repositories accessible via a GitHub integration.
 */
export async function listGitHubRepos(integration: GitHubIntegration): Promise<{
	repositories: Array<{
		id: number;
		full_name: string;
		private: boolean;
		clone_url: string;
		html_url: string;
		default_branch: string;
	}>;
}> {
	if (integration.githubInstallationId) {
		return listInstallationRepos(String(integration.githubInstallationId));
	}
	throw new Error("No GitHub App installation ID available for integration");
}

/**
 * Check if an integration uses GitHub App.
 */
export function isGitHubAppIntegration(integration: GitHubIntegration): boolean {
	return !!integration.githubInstallationId;
}
