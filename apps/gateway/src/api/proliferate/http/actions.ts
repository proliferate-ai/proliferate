/**
 * Actions Routes
 *
 * HTTP API for agent-initiated external actions (Sentry, Linear, etc.).
 * Sandbox agents call invoke/status; users call approve/deny.
 *
 * Routes (all under /:proliferateSessionId/actions/):
 *   GET  /available            — list available integrations + actions
 *   GET  /guide/:integration   — get provider guide for an integration
 *   POST /invoke               — invoke an action
 *   GET  /invocations/:id      — poll invocation status
 *   POST /invocations/:id/approve — approve a pending write
 *   POST /invocations/:id/deny    — deny a pending write
 *   GET  /invocations          — list invocations for this session
 */

import { createLogger } from "@proliferate/logger";
import type {
	ActionDefinition,
	ActionExecutionContext,
	ActionSource,
} from "@proliferate/providers";
import { ProviderActionSource } from "@proliferate/providers/action-source";
import { computeDefinitionHash, zodToJsonSchema } from "@proliferate/providers/helpers/schema";
import { truncateJson } from "@proliferate/providers/helpers/truncation";
import { getProviderActions } from "@proliferate/providers/providers/registry";
import {
	actions,
	connectors,
	integrations,
	orgs,
	secrets,
	sessions,
	userActionPreferences,
} from "@proliferate/services";
import type { ConnectorConfig } from "@proliferate/shared";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../hub";
import type { GatewayEnv } from "../../../lib/env";
import { ApiError } from "../../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "actions" });

// ============================================
// Rate Limiting (in-memory, per session)
// ============================================

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 invocations per minute per session

const invokeCounters = new Map<string, { count: number; resetAt: number }>();

function checkInvokeRateLimit(sessionId: string): void {
	const now = Date.now();
	let entry = invokeCounters.get(sessionId);
	if (!entry || now >= entry.resetAt) {
		entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
		invokeCounters.set(sessionId, entry);
	}
	entry.count++;
	if (entry.count > RATE_LIMIT_MAX) {
		throw new ApiError(429, "Too many action invocations. Try again later.");
	}
}

// Periodic cleanup of stale rate limit entries
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of invokeCounters) {
		if (now >= entry.resetAt) invokeCounters.delete(key);
	}
}, RATE_LIMIT_WINDOW_MS);

// ============================================
// Connector Tool Cache (per session, in-memory)
// ============================================

interface CachedConnectorTools {
	connectorId: string;
	connectorName: string;
	actions: ActionDefinition[];
	expiresAt: number;
}

const CONNECTOR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const connectorToolCache = new Map<string, CachedConnectorTools[]>();
const connectorRefreshInFlight = new Map<string, Promise<CachedConnectorTools[]>>();

// Periodic cleanup
setInterval(() => {
	const now = Date.now();
	for (const [key, entries] of connectorToolCache) {
		const valid = entries.filter((e) => now < e.expiresAt);
		if (valid.length === 0) connectorToolCache.delete(key);
		else connectorToolCache.set(key, valid);
	}
}, CONNECTOR_CACHE_TTL_MS);

/**
 * Load enabled connector configs for a session (session → org → org_connectors).
 */
async function loadSessionConnectors(
	sessionId: string,
): Promise<{ connectors: ConnectorConfig[]; orgId: string } | null> {
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) return null;

	const enabled = await connectors.listEnabledConnectors(session.organizationId);
	return { connectors: enabled, orgId: session.organizationId };
}

/**
 * Resolve the secret value for a connector's auth.
 */
async function resolveConnectorSecret(
	orgId: string,
	connector: ConnectorConfig,
): Promise<string | null> {
	return secrets.resolveSecretValue(orgId, connector.auth.secretKey);
}

/**
 * List tools for all enabled connectors for a session (with caching).
 */
async function listSessionConnectorTools(sessionId: string): Promise<CachedConnectorTools[]> {
	// Check cache
	const cached = connectorToolCache.get(sessionId);
	if (cached?.every((c) => Date.now() < c.expiresAt)) {
		return cached;
	}

	// Deduplicate concurrent refreshes for the same session
	const inFlight = connectorRefreshInFlight.get(sessionId);
	if (inFlight) return inFlight;

	const refreshPromise = (async () => {
		const ctx = await loadSessionConnectors(sessionId);
		if (!ctx || ctx.connectors.length === 0) return [];

		const results = await Promise.allSettled(
			ctx.connectors.map(async (connector) => {
				const secret = await resolveConnectorSecret(ctx.orgId, connector);
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
				(r): r is PromiseFulfilledResult<actions.connectors.ConnectorToolList> =>
					r.status === "fulfilled",
			)
			.map((r) => ({ ...r.value, expiresAt: Date.now() + CONNECTOR_CACHE_TTL_MS }));

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

/**
 * Resolve a connector config by its ID from the org connector catalog.
 */
async function resolveConnector(
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

// ============================================
// ActionSource resolution (DRY helper)
// ============================================

interface ResolvedAction {
	source: ActionSource;
	actionDef: ActionDefinition;
	ctx: ActionExecutionContext;
	isDrifted: boolean;
}

/**
 * Resolve an ActionSource, ActionDefinition, execution context, and drift status
 * for a given integration + action. Handles both connector-backed and provider-backed actions.
 */
async function resolveActionSource(
	sessionId: string,
	integration: string,
	action: string,
	auth?: { userId?: string },
): Promise<ResolvedAction> {
	if (integration.startsWith("connector:")) {
		const connectorId = integration.slice("connector:".length);
		const { connector, orgId, secret } = await resolveConnector(sessionId, connectorId);

		// Look up action definition from cached tools
		const tools = await listSessionConnectorTools(sessionId);
		const ct = tools.find((t) => t.connectorId === connectorId);
		const actionDef = ct?.actions.find((a) => a.id === action);
		if (!actionDef) {
			throw new ApiError(400, `Unknown action: ${integration}/${action}`);
		}

		const source = new actions.connectors.McpConnectorActionSource(connector, secret);

		// Compute drift by comparing current hash against stored override
		const storedOverrides = await connectors.getToolRiskOverrides(connector.id, orgId);
		let isDrifted = false;
		if (storedOverrides?.[action]?.hash) {
			const currentHash = computeDefinitionHash({ id: action, params: actionDef.params });
			isDrifted = currentHash !== storedOverrides[action].hash;
		}

		return {
			source,
			actionDef,
			ctx: { token: secret, orgId, sessionId },
			isDrifted,
		};
	}

	// Provider-backed action
	const module = getProviderActions(integration);
	if (!module) {
		throw new ApiError(400, `Unknown integration: ${integration}`);
	}

	const actionDef = module.actions.find((a) => a.id === action);
	if (!actionDef) {
		throw new ApiError(400, `Unknown action: ${integration}/${action}`);
	}

	const source = new ProviderActionSource(integration, integration, module);

	// Resolve token from OAuth connection
	const connectionsList = await sessions.listSessionConnections(sessionId);
	const conn = connectionsList.find(
		(c) => c.integration?.integrationId === integration && c.integration?.status === "active",
	);
	if (!conn?.integration) {
		throw new ApiError(400, `Integration ${integration} not connected to this session`);
	}

	const session = await sessions.findByIdInternal(sessionId);
	if (!session) throw new ApiError(404, "Session not found");

	const token = await integrations.getToken(
		{
			id: conn.integration.id,
			provider: conn.integration.provider,
			integrationId: conn.integration.integrationId,
			connectionId: conn.integration.connectionId,
			githubInstallationId: conn.integration.githubInstallationId,
		},
		{ userId: auth?.userId },
	);

	return {
		source,
		actionDef,
		ctx: { token, orgId: session.organizationId, sessionId },
		isDrifted: false,
	};
}

// ============================================
// Helpers
// ============================================

/**
 * Serialize an ActionDefinition's Zod params to JSON Schema for API responses.
 */
function actionToResponse(a: ActionDefinition) {
	return {
		name: a.id,
		description: a.description,
		riskLevel: a.riskLevel,
		params: zodToJsonSchema(a.params),
	};
}

/**
 * Verify that the authenticated user belongs to the session's org.
 * Returns the session row or throws 403/404.
 */
async function requireSessionOrgAccess(
	sessionId: string,
	userOrgId: string | undefined,
): Promise<{ organizationId: string }> {
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) {
		throw new ApiError(404, "Session not found");
	}
	if (!userOrgId || userOrgId !== session.organizationId) {
		throw new ApiError(403, "You do not have access to this session");
	}
	return session;
}

/**
 * Verify user has admin or owner role in the org.
 * Used for approve/deny — members can view but not approve.
 */
async function requireAdminRole(userId: string, orgId: string): Promise<void> {
	const role = await orgs.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		throw new ApiError(403, "Admin or owner role required for action approvals");
	}
}

// ============================================
// Router
// ============================================

export function createActionsRouter(_env: GatewayEnv, hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	// Set proliferateSessionId from URL params
	router.use((req, _res, next) => {
		req.proliferateSessionId = req.params.proliferateSessionId;
		next();
	});

	/**
	 * Try to attach the session hub for WS broadcasts (best-effort, non-blocking).
	 */
	async function tryGetHub(sessionId: string) {
		try {
			return await hubManager.getOrCreate(sessionId);
		} catch {
			return null;
		}
	}

	/**
	 * GET /available — list available integrations + actions for this session.
	 * Auth: sandbox token or user token (user must belong to session's org).
	 */
	router.get("/available", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;

			// Org check for non-sandbox callers
			if (req.auth?.source !== "sandbox") {
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}

			const connections = await sessions.listSessionConnections(sessionId);

			// Filter to active integrations that have a provider module
			const available = connections
				.filter((c) => c.integration?.status === "active")
				.map((c) => {
					const module = getProviderActions(c.integration!.integrationId);
					if (!module) return null;
					return {
						integrationId: c.integrationId,
						integration: c.integration!.integrationId,
						displayName: c.integration!.displayName,
						actions: module.actions.map(actionToResponse),
					};
				})
				.filter(Boolean);

			// Merge connector-backed tools
			const connectorTools = await listSessionConnectorTools(sessionId);
			const connectorIntegrations = connectorTools
				.filter((ct) => ct.actions.length > 0)
				.map((ct) => ({
					integrationId: null,
					integration: `connector:${ct.connectorId}`,
					displayName: ct.connectorName,
					actions: ct.actions.map(actionToResponse),
				}));

			let allIntegrations = [...available, ...connectorIntegrations];

			// Apply user action preference pre-filter
			const userId =
				req.auth?.source !== "sandbox"
					? req.auth?.userId
					: (await sessions.findByIdInternal(sessionId))?.createdBy;

			if (userId) {
				const orgId =
					req.auth?.orgId ?? (await sessions.findByIdInternal(sessionId))?.organizationId;
				if (orgId) {
					const disabled = await userActionPreferences.getDisabledSourceIds(userId, orgId);
					if (disabled.size > 0) {
						allIntegrations = allIntegrations.filter((i) => i && !disabled.has(i.integration));
					}
				}
			}

			res.json({ integrations: allIntegrations });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * GET /guide/:integration — get the provider guide for an integration.
	 * Auth: sandbox token or user token (user must belong to session's org).
	 */
	router.get("/guide/:integration", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;

			if (req.auth?.source !== "sandbox") {
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}

			const { integration } = req.params;

			// Connector-backed guide (auto-generated from tool definitions)
			if (integration.startsWith("connector:")) {
				const connectorId = integration.slice("connector:".length);
				const tools = await listSessionConnectorTools(sessionId);
				const ct = tools.find((t) => t.connectorId === connectorId);
				if (!ct || ct.actions.length === 0) {
					throw new ApiError(404, `No guide available for connector: ${connectorId}`);
				}

				const lines = [`# ${ct.connectorName} (MCP Connector)`, "", "## Available Actions", ""];
				for (const a of ct.actions) {
					lines.push(`### ${a.id} (${a.riskLevel})`);
					lines.push(a.description);

					// Convert Zod params to JSON Schema for guide rendering
					const schema = zodToJsonSchema(a.params);
					const properties = schema.properties as
						| Record<string, Record<string, unknown>>
						| undefined;
					if (properties && Object.keys(properties).length > 0) {
						const requiredSet = new Set(
							Array.isArray(schema.required) ? (schema.required as string[]) : [],
						);
						lines.push("");
						lines.push("**Parameters:**");
						for (const [name, prop] of Object.entries(properties)) {
							const type = (prop.type as string) ?? "object";
							const isRequired = requiredSet.has(name);
							lines.push(`- \`${name}\` (${type}${isRequired ? ", required" : ""})`);
						}
					}
					lines.push("");
				}

				res.json({ integration, guide: lines.join("\n") });
				return;
			}

			// Provider-backed guide
			const module = getProviderActions(integration);
			if (!module?.guide) {
				throw new ApiError(404, `No guide available for integration: ${integration}`);
			}

			res.json({ integration, guide: module.guide });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * POST /invoke — invoke an action.
	 * Auth: sandbox token only.
	 */
	router.post("/invoke", async (req, res, next) => {
		try {
			// Only sandbox agents can invoke actions
			if (req.auth?.source !== "sandbox") {
				throw new ApiError(403, "Only sandbox agents can invoke actions");
			}

			const sessionId = req.proliferateSessionId!;

			// Rate limit
			checkInvokeRateLimit(sessionId);

			const { integration, action, params } = req.body as {
				integration: string;
				action: string;
				params: Record<string, unknown>;
			};

			if (!integration || !action) {
				throw new ApiError(400, "Missing integration or action");
			}

			// Resolve session (used for preference check + invocation context)
			const session = await sessions.findByIdInternal(sessionId);
			if (!session) throw new ApiError(404, "Session not found");

			// Enforce user action preferences (belt-and-suspenders with GET /available filter)
			if (session.createdBy) {
				const disabled = await userActionPreferences.getDisabledSourceIds(
					session.createdBy,
					session.organizationId,
				);
				if (disabled.has(integration)) {
					throw new ApiError(403, "This integration is disabled by user preferences");
				}
			}

			// Resolve ActionSource, definition, context, and drift
			const resolved = await resolveActionSource(sessionId, integration, action);

			// Validate params against Zod schema
			const parseResult = resolved.actionDef.params.safeParse(params ?? {});
			if (!parseResult.success) {
				throw new ApiError(400, `Invalid params: ${parseResult.error.message}`);
			}
			const validatedParams = parseResult.data as Record<string, unknown>;

			// Create invocation via standard risk pipeline
			let result: Awaited<ReturnType<typeof actions.invokeAction>>;
			try {
				result = await actions.invokeAction({
					sessionId,
					organizationId: resolved.ctx.orgId,
					integrationId: integration.startsWith("connector:")
						? null
						: await findIntegrationId(sessionId, integration),
					integration,
					action,
					riskLevel: resolved.actionDef.riskLevel,
					params: validatedParams,
					isDrifted: resolved.isDrifted,
				});
			} catch (err) {
				if (err instanceof actions.PendingLimitError) {
					throw new ApiError(429, err.message);
				}
				throw err;
			}

			// Auto-approved: execute via ActionSource
			if (!result.needsApproval && result.invocation.status === "approved") {
				const startMs = Date.now();
				try {
					await actions.markExecuting(result.invocation.id);

					const actionResult = await resolved.source.execute(action, validatedParams, resolved.ctx);

					const durationMs = Date.now() - startMs;

					if (!actionResult.success) {
						throw new Error(actionResult.error ?? "Action failed");
					}

					// Truncate before sending HTTP response AND storing in DB
					const truncated = truncateJson(actionResult.data);
					const invocation = await actions.markCompleted(
						result.invocation.id,
						truncated,
						durationMs,
					);
					res.json({ invocation, result: truncated });
				} catch (err) {
					const durationMs = Date.now() - startMs;
					const errorMsg = err instanceof Error ? err.message : String(err);
					await actions.markFailed(result.invocation.id, errorMsg, durationMs);
					logger.error({ err, invocationId: result.invocation.id }, "Action execution failed");
					throw new ApiError(502, `Action failed: ${errorMsg}`);
				}
				return;
			}

			// Denied
			if (result.invocation.status === "denied") {
				res.status(403).json({
					invocation: result.invocation,
					error: "Action denied: danger-level actions are not allowed",
				});
				return;
			}

			// Pending approval — broadcast to connected WebSocket clients
			if (result.needsApproval) {
				const hub = await tryGetHub(sessionId);
				hub?.broadcastMessage({
					type: "action_approval_request",
					payload: {
						invocationId: result.invocation.id,
						integration,
						action,
						riskLevel: resolved.actionDef.riskLevel,
						params: validatedParams,
						expiresAt: result.invocation.expiresAt?.toISOString() ?? "",
					},
				});

				res.status(202).json({
					invocation: result.invocation,
					message: "Action requires approval",
				});
				return;
			}

			res.json({ invocation: result.invocation });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * GET /invocations/:invocationId — poll invocation status.
	 * Auth: sandbox token (scoped to session) or user token (org check).
	 */
	router.get("/invocations/:invocationId", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;
			const { invocationId } = req.params;

			if (req.auth?.source === "sandbox") {
				// Sandbox callers: scoped to their session
				const bySession = await actions.listSessionActions(sessionId);
				const found = bySession.find((i) => i.id === invocationId);
				if (!found) {
					throw new ApiError(404, "Invocation not found");
				}
				res.json({ invocation: found });
			} else {
				// User callers: verify org membership
				const session = await requireSessionOrgAccess(sessionId, req.auth?.orgId);
				const invocation = await actions.getActionStatus(invocationId, session.organizationId);
				if (!invocation) {
					throw new ApiError(404, "Invocation not found");
				}
				res.json({ invocation });
			}
		} catch (err) {
			next(err);
		}
	});

	/**
	 * POST /invocations/:invocationId/approve — approve a pending write.
	 * Auth: user token only (JWT or CLI). Must belong to session's org.
	 */
	router.post("/invocations/:invocationId/approve", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth?.userId) {
				throw new ApiError(401, "User authentication required for approvals");
			}

			const { invocationId } = req.params;
			const session = await requireSessionOrgAccess(req.proliferateSessionId!, auth.orgId);
			await requireAdminRole(auth.userId, session.organizationId);

			// Approve the invocation (checks status + org + expiry)
			let invocation: Awaited<ReturnType<typeof actions.approveAction>>;
			try {
				invocation = await actions.approveAction(invocationId, session.organizationId, auth.userId);
			} catch (err) {
				if (err instanceof actions.ActionNotFoundError) throw new ApiError(404, err.message);
				if (err instanceof actions.ActionExpiredError) throw new ApiError(410, err.message);
				if (err instanceof actions.ActionConflictError) throw new ApiError(409, err.message);
				throw err;
			}

			// Execute the action immediately after approval
			const startMs = Date.now();
			try {
				await actions.markExecuting(invocationId);

				// Resolve action source from the stored invocation
				const resolved = await resolveActionSource(
					invocation.sessionId,
					invocation.integration,
					invocation.action,
					{ userId: auth.userId },
				);

				const actionResult = await resolved.source.execute(
					invocation.action,
					(invocation.params as Record<string, unknown>) ?? {},
					resolved.ctx,
				);

				const durationMs = Date.now() - startMs;

				if (!actionResult.success) {
					throw new Error(actionResult.error ?? "Action failed");
				}

				// Truncate before sending HTTP response AND storing in DB
				const truncated = truncateJson(actionResult.data);
				const completed = await actions.markCompleted(invocationId, truncated, durationMs);

				// Broadcast completion
				const hub = await tryGetHub(invocation.sessionId);
				hub?.broadcastMessage({
					type: "action_completed",
					payload: {
						invocationId,
						status: "completed",
						result: truncated,
					},
				});

				res.json({
					invocation: completed,
					result: truncated,
				});
			} catch (err) {
				const durationMs = Date.now() - startMs;
				const errorMsg = err instanceof Error ? err.message : String(err);
				await actions.markFailed(invocationId, errorMsg, durationMs);

				const hub = await tryGetHub(invocation.sessionId);
				hub?.broadcastMessage({
					type: "action_completed",
					payload: {
						invocationId,
						status: "failed",
						error: errorMsg,
					},
				});

				logger.error({ err, invocationId }, "Action execution failed after approval");
				throw new ApiError(502, `Action failed: ${errorMsg}`);
			}
		} catch (err) {
			next(err);
		}
	});

	/**
	 * POST /invocations/:invocationId/deny — deny a pending write.
	 * Auth: user token only (JWT or CLI). Must belong to session's org.
	 */
	router.post("/invocations/:invocationId/deny", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth?.userId) {
				throw new ApiError(401, "User authentication required for denials");
			}

			const { invocationId } = req.params;
			const session = await requireSessionOrgAccess(req.proliferateSessionId!, auth.orgId);
			await requireAdminRole(auth.userId, session.organizationId);

			let invocation: Awaited<ReturnType<typeof actions.denyAction>>;
			try {
				invocation = await actions.denyAction(invocationId, session.organizationId, auth.userId);
			} catch (err) {
				if (err instanceof actions.ActionNotFoundError) throw new ApiError(404, err.message);
				if (err instanceof actions.ActionConflictError) throw new ApiError(409, err.message);
				throw err;
			}

			// Broadcast denial
			const hub = await tryGetHub(invocation.sessionId);
			hub?.broadcastMessage({
				type: "action_approval_result",
				payload: {
					invocationId,
					status: "denied",
					approvedBy: auth.userId,
				},
			});

			res.json({ invocation });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * GET /invocations — list all invocations for this session.
	 * Auth: sandbox token (scoped to session) or user token (org check).
	 */
	router.get("/invocations", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;

			// Org check for non-sandbox callers
			if (req.auth?.source !== "sandbox") {
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}

			const invocations = await actions.listSessionActions(sessionId);
			res.json({ invocations });
		} catch (err) {
			next(err);
		}
	});

	return router;
}

// ============================================
// Internal helpers
// ============================================

/**
 * Find the integrationId (FK) for a provider integration from session connections.
 */
async function findIntegrationId(sessionId: string, integration: string): Promise<string | null> {
	const connections = await sessions.listSessionConnections(sessionId);
	const conn = connections.find(
		(c) => c.integration?.integrationId === integration && c.integration?.status === "active",
	);
	return conn?.integrationId ?? null;
}
