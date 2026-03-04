import { ProviderActionSource } from "@proliferate/providers/action-source";
import { getProviderActions } from "@proliferate/providers/providers/registry";
import { actions, integrations, sessions } from "@proliferate/services";
import { ApiError } from "../../../../../middleware/errors";
import {
	computeConnectorDrift,
	listSessionConnectorTools,
	resolveConnector,
} from "./connector-cache";
import type { ResolvedAction } from "./types";

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
	const connections = await sessions.listSessionConnections(sessionId);
	const connection = connections.find(
		(entry) =>
			entry.integration?.integrationId === integration && entry.integration?.status === "active",
	);
	if (!connection?.integration) {
		throw new ApiError(400, `Integration ${integration} not connected to this session`);
	}

	const session = await sessions.findByIdInternal(sessionId);
	if (!session) throw new ApiError(404, "Session not found");

	const token = await integrations.getToken({
		id: connection.integration.id,
		provider: connection.integration.provider,
		integrationId: connection.integration.integrationId,
		connectionId: connection.integration.connectionId,
		githubInstallationId: connection.integration.githubInstallationId,
	});

	return {
		source,
		actionDef,
		ctx: { token, orgId: session.organizationId, sessionId },
		isDrifted: false,
	};
}

export async function findIntegrationId(
	sessionId: string,
	integration: string,
): Promise<string | null> {
	const connections = await sessions.listSessionConnections(sessionId);
	const connection = connections.find(
		(entry) =>
			entry.integration?.integrationId === integration && entry.integration?.status === "active",
	);
	return connection?.integrationId ?? null;
}
