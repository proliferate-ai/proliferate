/**
 * GitHub Token Abstraction
 *
 * Provides a unified interface for getting GitHub tokens, supporting both:
 * - GitHub App installation tokens (production)
 * - Nango OAuth tokens (local development)
 */

import { getInstallationToken, listInstallationRepos } from "@/lib/github-app";
import getNango, { requireNangoIntegrationId } from "@/lib/nango";

export interface GitHubIntegration {
	id: string;
	githubInstallationId?: number | string | null;
	connectionId: string | null;
	provider?: string;
}

/**
 * Get a GitHub access token for an integration.
 * Supports both GitHub App (installation token) and Nango (OAuth token).
 */
export async function getGitHubTokenForIntegration(
	integration: GitHubIntegration,
): Promise<string> {
	// GitHub App path - use installation token
	if (integration.githubInstallationId) {
		return getInstallationToken(String(integration.githubInstallationId));
	}

	// Nango path - get OAuth token from Nango
	if (integration.connectionId) {
		const nango = getNango();
		const integrationId = requireNangoIntegrationId("github");
		const connection = await nango.getConnection(integrationId, integration.connectionId);

		const credentials = connection.credentials as {
			access_token?: string;
		};

		if (!credentials.access_token) {
			throw new Error("No access token available from Nango connection");
		}

		return credentials.access_token;
	}

	throw new Error(
		"No GitHub credentials available - missing both installation_id and connection_id",
	);
}

/**
 * List repositories accessible via a GitHub integration.
 * Supports both GitHub App and Nango OAuth.
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
	// GitHub App path - use dedicated function
	if (integration.githubInstallationId) {
		return listInstallationRepos(String(integration.githubInstallationId));
	}

	// Nango path - call GitHub API with token from Nango
	// Note: If Nango is configured with a GitHub App, use /installation/repositories
	// If Nango is configured with OAuth App, use /user/repos
	if (integration.connectionId) {
		const token = await getGitHubTokenForIntegration(integration);

		// Try /installation/repositories first (for GitHub App tokens)
		let response = await fetch("https://api.github.com/installation/repositories?per_page=100", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		// If that fails, fall back to /user/repos (for OAuth tokens)
		if (!response.ok) {
			response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			});
		}

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to list repositories: ${error}`);
		}

		const data = await response.json();
		// /installation/repositories returns { repositories: [...] }, /user/repos returns [...]
		const repos = Array.isArray(data) ? data : data.repositories;
		return { repositories: repos };
	}

	throw new Error("No GitHub credentials available");
}

/**
 * Check if an integration uses GitHub App (vs Nango OAuth)
 */
export function isGitHubAppIntegration(integration: GitHubIntegration): boolean {
	return !!integration.githubInstallationId;
}

/**
 * Check if an integration uses Nango OAuth (vs GitHub App)
 */
export function isNangoGitHubIntegration(integration: GitHubIntegration): boolean {
	return !integration.githubInstallationId && !!integration.connectionId;
}
