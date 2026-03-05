import { ProviderActionSource } from "@proliferate/providers/action-source";
import { getProviderActions } from "@proliferate/providers/providers/registry";
import { actions, integrations } from "@proliferate/services";
import { ApiError } from "../../../../../server/middleware/errors";
import {
	computeConnectorDrift,
	listSessionConnectorTools,
	resolveConnector,
} from "./connector-cache";
import { resolveProviderConnectionsForSession } from "./provider-connections";
import type { ResolvedAction } from "./types";

function findActiveConnection(
	connections: Awaited<ReturnType<typeof resolveProviderConnectionsForSession>>["connections"],
	integration: string,
) {
	return connections.find(
		(entry) =>
			entry.integration?.integrationId === integration && entry.integration?.status === "active",
	);
}

async function buildTokenInput(params: {
	sessionId: string;
	integration: string;
	source: "session_connections" | "org_fallback";
	connectionIntegrationId: string;
	orgId: string;
}) {
	const integrationRow = await integrations.findByIdAndOrg(
		params.connectionIntegrationId,
		params.orgId,
	);
	if (!integrationRow) {
		throw new ApiError(404, `Integration ${params.connectionIntegrationId} not found`);
	}

	return {
		id: integrationRow.id,
		provider: integrationRow.provider,
		integrationId: integrationRow.integrationId,
		connectionId: integrationRow.connectionId,
		githubInstallationId: integrationRow.githubInstallationId,
		organizationId: integrationRow.organizationId,
		status: integrationRow.status,
		encryptedAccessToken: integrationRow.encryptedAccessToken,
		encryptedRefreshToken: integrationRow.encryptedRefreshToken,
		tokenExpiresAt: integrationRow.tokenExpiresAt,
		tokenType: integrationRow.tokenType,
		connectionMetadata: integrationRow.connectionMetadata as Record<string, unknown> | null,
	};
}

export async function resolveActionSource(
	sessionId: string,
	integration: string,
	action: string,
): Promise<ResolvedAction> {
	if (integration.startsWith("connector:")) {
		const connectorId = integration.slice("connector:".length);
		const { connector, orgId, secret } = await resolveConnector(sessionId, connectorId);

		const tools = await listSessionConnectorTools(sessionId);
		const connectorTools = tools.find((entry) => entry.connectorId === connectorId);
		const actionDef = connectorTools?.actions.find((entry) => entry.id === action);
		if (!actionDef) {
			throw new ApiError(400, `Unknown action: ${integration}/${action}`);
		}

		const isDrifted = await computeConnectorDrift(connector.id, orgId, action, actionDef);
		const source = new actions.connectors.McpConnectorActionSource(connector, secret);

		return {
			source,
			actionDef,
			ctx: { token: secret, orgId, sessionId },
			isDrifted,
		};
	}

	const module = getProviderActions(integration);
	if (!module) {
		throw new ApiError(400, `Unknown integration: ${integration}`);
	}

	const actionDef = module.actions.find((entry) => entry.id === action);
	if (!actionDef) {
		throw new ApiError(400, `Unknown action: ${integration}/${action}`);
	}

	const source = new ProviderActionSource(integration, integration, module);
	const providerConnections = await resolveProviderConnectionsForSession(sessionId);
	const connection = findActiveConnection(providerConnections.connections, integration);
	if (!connection?.integration) {
		throw new ApiError(400, `Integration ${integration} not connected to this session`);
	}

	const tokenInput = await buildTokenInput({
		sessionId,
		integration,
		source: providerConnections.source,
		connectionIntegrationId: connection.integration.id,
		orgId: providerConnections.organizationId,
	});
	const token = await integrations.getToken(tokenInput);

	return {
		source,
		actionDef,
		ctx: { token, orgId: providerConnections.organizationId, sessionId },
		isDrifted: false,
	};
}

export async function findIntegrationId(
	sessionId: string,
	integration: string,
): Promise<string | null> {
	const providerConnections = await resolveProviderConnectionsForSession(sessionId);
	const connection = findActiveConnection(providerConnections.connections, integration);
	return connection?.integrationId ?? null;
}
