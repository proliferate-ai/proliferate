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
import {
	type ActionSource,
	type ConnectorActionSource,
	getAdapterSource,
} from "@proliferate/providers";
import { actions, connectors, integrations, orgs, secrets, sessions } from "@proliferate/services";
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
// Connector Source Cache (per session, in-memory)
// ============================================

type CachedConnectorSource = ConnectorActionSource & { expiresAt: number };

const CONNECTOR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const connectorSourceCache = new Map<string, CachedConnectorSource[]>();
const connectorRefreshInFlight = new Map<string, Promise<CachedConnectorSource[]>>();

// Periodic cleanup
setInterval(() => {
	const now = Date.now();
	for (const [key, entries] of connectorSourceCache) {
		const valid = entries.filter((e) => now < e.expiresAt);
		if (valid.length === 0) connectorSourceCache.delete(key);
		else connectorSourceCache.set(key, valid);
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
 * Build a ConnectorActionSource from a connector config and its discovered tools.
 */
function buildConnectorSource(
	connector: ConnectorConfig,
	toolList: actions.connectors.ConnectorToolList,
): CachedConnectorSource {
	return {
		type: "connector",
		id: connector.id,
		displayName: toolList.connectorName,
		connectorId: connector.id,
		url: connector.url,
		transport: "remote_http",
		defaultRisk: connector.riskPolicy?.defaultRisk ?? "write",
		toolRiskOverrides: connector.riskPolicy?.overrides,
		actions: toolList.actions,
		expiresAt: Date.now() + CONNECTOR_CACHE_TTL_MS,
	};
}

/**
 * List connector sources for a session (with caching).
 */
async function listSessionConnectorSources(sessionId: string): Promise<CachedConnectorSource[]> {
	// Check cache
	const cached = connectorSourceCache.get(sessionId);
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
					return buildConnectorSource(connector, {
						connectorId: connector.id,
						connectorName: connector.name,
						actions: [],
					});
				}
				const toolList = await actions.connectors.listConnectorTools(connector, secret);
				return buildConnectorSource(connector, toolList);
			}),
		);

		const sources = results
			.filter((r): r is PromiseFulfilledResult<CachedConnectorSource> => r.status === "fulfilled")
			.map((r) => r.value);

		connectorSourceCache.set(sessionId, sources);
		return sources;
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
// Action Source Serialization
// ============================================

/**
 * Serialize an ActionSource for the API response.
 * Strips functions (execute) and sensitive fields (url).
 */
function serializeSource(source: ActionSource) {
	const base = {
		type: source.type,
		id: source.id,
		displayName: source.displayName,
		actions: source.actions,
		guide: source.guide,
	};
	if (source.type === "adapter") {
		return { ...base, integration: source.integration };
	}
	return { ...base, connectorId: source.connectorId };
}

// ============================================
// Helpers
// ============================================

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
	 * GET /available — list available action sources for this session.
	 * Returns a unified ActionSource[] merging adapter-based and connector-backed sources.
	 * Auth: sandbox token or user token (user must belong to session's org).
	 */
	router.get("/available", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;

			// Org check for non-sandbox callers
			if (req.auth?.source !== "sandbox") {
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}

			// Adapter sources: resolve from session connections + provider registry
			const connections = await sessions.listSessionConnections(sessionId);
			const adapterSources: ActionSource[] = connections
				.filter((c) => c.integration?.status === "active")
				.map((c) => getAdapterSource(c.integration!.integrationId))
				.filter((s): s is NonNullable<typeof s> => s != null);

			// Connector sources: resolve from org connector catalog
			const connectorSources = await listSessionConnectorSources(sessionId);
			const activeConnectorSources: ActionSource[] = connectorSources.filter(
				(s) => s.actions.length > 0,
			);

			const sources = [...adapterSources, ...activeConnectorSources];
			res.json({ sources: sources.map(serializeSource) });
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
				const sources = await listSessionConnectorSources(sessionId);
				const source = sources.find((s) => s.connectorId === connectorId);
				if (!source || source.actions.length === 0) {
					throw new ApiError(404, `No guide available for connector: ${connectorId}`);
				}

				// Use the source's guide if set, otherwise auto-generate
				if (source.guide) {
					res.json({ integration, guide: source.guide });
					return;
				}

				const lines = [`# ${source.displayName} (MCP Connector)`, "", "## Available Actions", ""];
				for (const a of source.actions) {
					lines.push(`### ${a.name} (${a.riskLevel})`);
					lines.push(a.description);
					if (a.params.length > 0) {
						lines.push("");
						lines.push("**Parameters:**");
						for (const p of a.params) {
							lines.push(
								`- \`${p.name}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`,
							);
						}
					}
					lines.push("");
				}

				res.json({ integration, guide: lines.join("\n") });
				return;
			}

			// Adapter-backed guide from provider source
			const source = getAdapterSource(integration);
			if (!source?.guide) {
				throw new ApiError(404, `No guide available for integration: ${integration}`);
			}

			res.json({ integration, guide: source.guide });
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

			// ── Connector-backed action path ──
			if (integration.startsWith("connector:")) {
				const connectorId = integration.slice("connector:".length);
				const { connector, orgId, secret } = await resolveConnector(sessionId, connectorId);

				// Look up action definition from cached connector sources
				const sources = await listSessionConnectorSources(sessionId);
				const connectorSource = sources.find((s) => s.connectorId === connectorId);
				const actionDef = connectorSource?.actions.find((a) => a.name === action);
				if (!actionDef) {
					throw new ApiError(400, `Unknown action: ${integration}/${action}`);
				}

				// Create invocation via standard risk pipeline
				let result: Awaited<ReturnType<typeof actions.invokeAction>>;
				try {
					result = await actions.invokeAction({
						sessionId,
						organizationId: orgId,
						integrationId: null,
						integration,
						action,
						riskLevel: actionDef.riskLevel,
						params: params ?? {},
					});
				} catch (err) {
					if (err instanceof actions.PendingLimitError) {
						throw new ApiError(429, err.message);
					}
					throw err;
				}

				// Auto-approved: execute via MCP
				if (!result.needsApproval && result.invocation.status === "approved") {
					const startMs = Date.now();
					try {
						await actions.markExecuting(result.invocation.id);
						const callResult = await actions.connectors.callConnectorTool(
							connector,
							secret,
							action,
							params ?? {},
						);

						if (callResult.isError) {
							throw new Error(
								typeof callResult.content === "string"
									? callResult.content
									: JSON.stringify(callResult.content),
							);
						}

						const durationMs = Date.now() - startMs;
						const invocation = await actions.markCompleted(
							result.invocation.id,
							callResult.content,
							durationMs,
						);
						res.json({ invocation, result: callResult.content });
					} catch (err) {
						const durationMs = Date.now() - startMs;
						const errorMsg = err instanceof Error ? err.message : String(err);
						await actions.markFailed(result.invocation.id, errorMsg, durationMs);
						logger.error({ err, invocationId: result.invocation.id }, "Connector action failed");
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

				// Pending approval
				if (result.needsApproval) {
					const hub = await tryGetHub(sessionId);
					hub?.broadcastMessage({
						type: "action_approval_request",
						payload: {
							invocationId: result.invocation.id,
							integration,
							action,
							riskLevel: actionDef.riskLevel,
							params: params ?? {},
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
				return;
			}

			// ── Static adapter path ──

			// Find adapter source from provider registry
			const source = getAdapterSource(integration);
			if (!source) {
				throw new ApiError(400, `Unknown integration: ${integration}`);
			}

			// Validate action exists
			const actionDef = source.actions.find((a) => a.name === action);
			if (!actionDef) {
				throw new ApiError(400, `Unknown action: ${integration}/${action}`);
			}

			// Resolve session org + integration ID
			const connections = await sessions.listSessionConnections(sessionId);
			const conn = connections.find(
				(c) => c.integration?.integrationId === integration && c.integration?.status === "active",
			);
			if (!conn?.integration) {
				throw new ApiError(400, `Integration ${integration} not connected to this session`);
			}

			// Look up org from session
			const session = await sessions.findByIdInternal(sessionId);
			if (!session) {
				throw new ApiError(404, "Session not found");
			}

			// Create invocation (risk-based policy + grant evaluation)
			let result: Awaited<ReturnType<typeof actions.invokeAction>>;
			try {
				result = await actions.invokeAction({
					sessionId,
					organizationId: session.organizationId,
					integrationId: conn.integrationId,
					integration,
					action,
					riskLevel: actionDef.riskLevel,
					params: params ?? {},
				});
			} catch (err) {
				if (err instanceof actions.PendingLimitError) {
					throw new ApiError(429, err.message);
				}
				throw err;
			}

			// Auto-approved (reads + grant-approved writes): execute immediately
			if (!result.needsApproval && result.invocation.status === "approved") {
				const startMs = Date.now();
				try {
					await actions.markExecuting(result.invocation.id);

					// Resolve token
					const token = await integrations.getToken({
						id: conn.integration.id,
						provider: conn.integration.provider,
						integrationId: conn.integration.integrationId,
						connectionId: conn.integration.connectionId,
						githubInstallationId: conn.integration.githubInstallationId,
					});

					const actionResult = await source.execute(action, params ?? {}, token);
					const durationMs = Date.now() - startMs;
					if (!actionResult.success) {
						throw new Error(actionResult.error ?? "Action failed");
					}
					const invocation = await actions.markCompleted(
						result.invocation.id,
						actionResult.data,
						durationMs,
					);
					res.json({ invocation, result: actionResult.data });
				} catch (err) {
					const durationMs = Date.now() - startMs;
					const errorMsg = err instanceof Error ? err.message : String(err);
					await actions.markFailed(result.invocation.id, errorMsg, durationMs);
					logger.error({ err, invocationId: result.invocation.id }, "Action execution failed");
					throw new ApiError(502, `Action failed: ${errorMsg}`);
				}
				return;
			}

			// Denied (danger level)
			if (result.invocation.status === "denied") {
				res.status(403).json({
					invocation: result.invocation,
					error: "Action denied: danger-level actions are not allowed",
				});
				return;
			}

			// Pending approval (write) — broadcast to connected WebSocket clients
			if (result.needsApproval) {
				const hub = await tryGetHub(sessionId);
				hub?.broadcastMessage({
					type: "action_approval_request",
					payload: {
						invocationId: result.invocation.id,
						integration,
						action,
						riskLevel: actionDef.riskLevel,
						params: params ?? {},
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

				let actionResult: unknown;
				const isConnectorAction = invocation.integration.startsWith("connector:");

				if (isConnectorAction) {
					// ── Connector execution path ──
					// Use invocation's session ID (not route session) to resolve the correct org/session context
					const connectorId = invocation.integration.slice("connector:".length);
					const { connector, secret } = await resolveConnector(invocation.sessionId, connectorId);
					const callResult = await actions.connectors.callConnectorTool(
						connector,
						secret,
						invocation.action,
						(invocation.params as Record<string, unknown>) ?? {},
					);
					if (callResult.isError) {
						throw new Error(
							typeof callResult.content === "string"
								? callResult.content
								: JSON.stringify(callResult.content),
						);
					}
					actionResult = callResult.content;
				} else {
					// ── Static adapter execution path ──
					const connections = await sessions.listSessionConnections(invocation.sessionId);
					const conn = connections.find((c) => c.integrationId === invocation.integrationId);
					if (!conn?.integration) {
						throw new Error("Integration no longer available");
					}

					const adapterSource = getAdapterSource(invocation.integration);
					if (!adapterSource) {
						throw new Error(`No adapter for ${invocation.integration}`);
					}

					const token = await integrations.getToken({
						id: conn.integration.id,
						provider: conn.integration.provider,
						integrationId: conn.integration.integrationId,
						connectionId: conn.integration.connectionId,
						githubInstallationId: conn.integration.githubInstallationId,
					});

					const adapterResult = await adapterSource.execute(
						invocation.action,
						(invocation.params as Record<string, unknown>) ?? {},
						token,
					);
					if (!adapterResult.success) {
						throw new Error(adapterResult.error ?? "Action failed");
					}
					actionResult = adapterResult.data;
				}

				const durationMs = Date.now() - startMs;
				const completed = await actions.markCompleted(invocationId, actionResult, durationMs);

				// Broadcast completion
				const hub = await tryGetHub(invocation.sessionId);
				hub?.broadcastMessage({
					type: "action_completed",
					payload: {
						invocationId,
						status: "completed",
						result: actionResult,
					},
				});

				res.json({
					invocation: completed,
					result: actionResult,
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
