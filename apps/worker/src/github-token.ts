/**
 * Shared GitHub token resolution utility.
 *
 * Resolves the best available GitHub token for a repo, preferring
 * repo-linked integration connections, then falling back to org-wide.
 */

import { integrations } from "@proliferate/services";

export async function resolveGitHubToken(orgId: string, repoId: string): Promise<string> {
	// 1) Prefer repo-linked connections.
	const repoConnections = await integrations.getRepoConnectionsWithIntegrations(repoId);
	const activeIntegrations = repoConnections
		.map((rc) => rc.integration)
		.filter((i): i is NonNullable<typeof i> => Boolean(i))
		.filter((i) => i.status === "active");

	const preferred =
		activeIntegrations.find((i) => Boolean(i.githubInstallationId)) ??
		activeIntegrations[0] ??
		null;

	if (preferred?.githubInstallationId) {
		return integrations.getInstallationToken(preferred.githubInstallationId);
	}

	if (preferred?.connectionId) {
		// Legacy non-GitHub-App connections are no longer supported.
		return "";
	}

	// 2) Fall back to org-wide GitHub integration.
	const githubAppIntegration = await integrations.findActiveGitHubApp(orgId);
	if (githubAppIntegration?.githubInstallationId) {
		return integrations.getInstallationToken(githubAppIntegration.githubInstallationId);
	}

	return "";
}
