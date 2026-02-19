/**
 * Shared GitHub token resolution utility.
 *
 * Resolves the best available GitHub token for a repo, preferring
 * repo-linked integration connections, then falling back to org-wide.
 */

import { env } from "@proliferate/environment/server";
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
		const nangoIntegrationId = env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID;
		if (!nangoIntegrationId) return "";

		return integrations.getToken({
			id: preferred.id,
			provider: "nango",
			integrationId: nangoIntegrationId,
			connectionId: preferred.connectionId,
			githubInstallationId: null,
		});
	}

	// 2) Fall back to org-wide GitHub integration.
	const githubAppIntegration = await integrations.findActiveGitHubApp(orgId);
	if (githubAppIntegration?.githubInstallationId) {
		return integrations.getInstallationToken(githubAppIntegration.githubInstallationId);
	}

	const nangoIntegrationId = env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID;
	if (!nangoIntegrationId) return "";

	const nangoIntegration = await integrations.findActiveNangoGitHub(orgId, nangoIntegrationId);
	if (nangoIntegration?.connectionId) {
		return integrations.getToken({
			id: nangoIntegration.id,
			provider: "nango",
			integrationId: nangoIntegrationId,
			connectionId: nangoIntegration.connectionId,
			githubInstallationId: null,
		});
	}

	return "";
}
