import { createLogger } from "@proliferate/logger";
import type { ActionDefinition } from "@proliferate/providers";
import { computeDefinitionHash } from "@proliferate/providers/helpers/schema";
import { actions, connectors, secrets, sessions } from "@proliferate/services";
import type { ConnectorConfig } from "@proliferate/shared";
import { ApiError } from "../../../../../middleware/errors";
import type { CachedConnectorTools, SessionConnectorContext } from "./types";

const logger = createLogger({ service: "gateway" }).child({ module: "actions-connector-cache" });

const CONNECTOR_CACHE_TTL_MS = 5 * 60 * 1000;

const connectorToolCache = new Map<string, CachedConnectorTools[]>();
const connectorRefreshInFlight = new Map<string, Promise<CachedConnectorTools[]>>();

setInterval(() => {
	const now = Date.now();
	for (const [key, entries] of connectorToolCache) {
		const valid = entries.filter((entry) => now < entry.expiresAt);
		if (valid.length === 0) {
			connectorToolCache.delete(key);
		} else {
			connectorToolCache.set(key, valid);
		}
	}
}, CONNECTOR_CACHE_TTL_MS);

export async function loadSessionConnectors(
	sessionId: string,
): Promise<SessionConnectorContext | null> {
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) return null;

	const enabled = await connectors.listEnabledConnectors(session.organizationId);
	return { connectors: enabled, orgId: session.organizationId };
}

export async function resolveConnectorSecret(
	orgId: string,
	connector: ConnectorConfig,
): Promise<string | null> {
	return secrets.resolveSecretValue(orgId, connector.auth.secretKey);
}

export async function listSessionConnectorTools(
	sessionId: string,
): Promise<CachedConnectorTools[]> {
	const cached = connectorToolCache.get(sessionId);
	if (cached?.every((entry) => Date.now() < entry.expiresAt)) {
		return cached;
	}

	const inFlight = connectorRefreshInFlight.get(sessionId);
	if (inFlight) return inFlight;

	const refreshPromise = (async () => {
		const context = await loadSessionConnectors(sessionId);
		if (!context || context.connectors.length === 0) return [];

		const results = await Promise.allSettled(
			context.connectors.map(async (connector) => {
				const secret = await resolveConnectorSecret(context.orgId, connector);
				if (!secret) {
					logger.warn(
						{ connectorId: connector.id, secretKey: connector.auth.secretKey },
						"Connector secret not found, skipping",
					);
					return {
						connectorId: connector.id,
						connectorName: connector.name,
						actions: [] as ActionDefinition[],
					};
				}
				return actions.connectors.listConnectorTools(connector, secret);
			}),
		);

		const toolLists = results
			.filter(
				(result): result is PromiseFulfilledResult<actions.connectors.ConnectorToolList> =>
					result.status === "fulfilled",
			)
			.map((result) => ({ ...result.value, expiresAt: Date.now() + CONNECTOR_CACHE_TTL_MS }));

		connectorToolCache.set(sessionId, toolLists);
		return toolLists;
	})();

	connectorRefreshInFlight.set(sessionId, refreshPromise);
	try {
		return await refreshPromise;
	} finally {
		connectorRefreshInFlight.delete(sessionId);
	}
}

export async function resolveConnector(
	sessionId: string,
	connectorId: string,
): Promise<{ connector: ConnectorConfig; orgId: string; secret: string }> {
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) throw new ApiError(404, "Session not found");

	const connector = await connectors.getConnector(connectorId, session.organizationId);
	if (!connector || !connector.enabled) {
		throw new ApiError(400, `Unknown connector: ${connectorId}`);
	}

	const secret = await resolveConnectorSecret(session.organizationId, connector);
	if (!secret) {
		throw new ApiError(500, `Secret "${connector.auth.secretKey}" not found for connector`);
	}

	return { connector, orgId: session.organizationId, secret };
}

export async function computeConnectorDrift(
	connectorId: string,
	orgId: string,
	actionId: string,
	actionDef: ActionDefinition,
): Promise<boolean> {
	const storedOverrides = await connectors.getToolRiskOverrides(connectorId, orgId);
	if (!storedOverrides?.[actionId]?.hash) {
		return false;
	}
	const currentHash = computeDefinitionHash({ id: actionId, params: actionDef.params });
	return currentHash !== storedOverrides[actionId].hash;
}
