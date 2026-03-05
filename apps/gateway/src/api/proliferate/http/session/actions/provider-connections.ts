import { integrations, sessions } from "@proliferate/services";
import { ApiError } from "../../../../../server/middleware/errors";

export type ProviderConnectionSource = "session_connections" | "org_fallback";

export interface ProviderIntegrationConnection {
	integrationId: string;
	integration: {
		id: string;
		provider: string;
		integrationId: string;
		connectionId: string;
		displayName: string | null;
		status: string | null;
		githubInstallationId: string | null;
	};
}

export interface ResolvedProviderConnections {
	source: ProviderConnectionSource;
	organizationId: string;
	connections: ProviderIntegrationConnection[];
}

export async function resolveProviderConnectionsForSession(
	sessionId: string,
): Promise<ResolvedProviderConnections> {
	const session = await sessions.findSessionByIdInternal(sessionId);
	if (!session) {
		throw new ApiError(404, "Session not found");
	}

	const sessionConnections = await sessions.listSessionConnections(sessionId);
	const activeSessionConnections = sessionConnections
		.filter((entry) => entry.integration?.status === "active")
		.map((entry) => entry as ProviderIntegrationConnection);

	if (activeSessionConnections.length > 0) {
		return {
			source: "session_connections",
			organizationId: session.organizationId,
			connections: activeSessionConnections,
		};
	}

	const activeOrgIntegrations = await integrations.listActiveIntegrationsForOrganization(
		session.organizationId,
	);
	const fallbackConnections = activeOrgIntegrations.map((integration) => ({
		integrationId: integration.id,
		integration: {
			id: integration.id,
			provider: integration.provider,
			integrationId: integration.integrationId,
			connectionId: integration.connectionId,
			displayName: integration.displayName,
			status: integration.status,
			githubInstallationId: integration.githubInstallationId,
		},
	}));

	return {
		source: "org_fallback",
		organizationId: session.organizationId,
		connections: fallbackConnections,
	};
}
