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
// Connector Tool Cache (per session, in-memory)
// ============================================

interface CachedConnectorTools {
	connectorId: string;
	connectorName: string;
	actions: actions.ActionDefinition[];
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
						actions: [] as actions.ActionDefinition[],
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

			// Filter to active integrations that have an adapter
			const available = connections
				.filter((c) => c.integration?.status === "active")
				.map((c) => {
					const adapter = actions.getAdapter(c.integration!.integrationId);
					if (!adapter) return null;
					return {
						integrationId: c.integrationId,
						integration: adapter.integration,
						displayName: c.integration!.displayName,
						actions: adapter.actions.map((a) => ({
							name: a.name,
							description: a.description,
							riskLevel: a.riskLevel,
							params: a.params,
						})),
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
					actions: ct.actions.map((a) => ({
						name: a.name,
						description: a.description,
						riskLevel: a.riskLevel,
						params: a.params,
					})),
				}));

			res.json({ integrations: [...available, ...connectorIntegrations] });
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

			const guide = actions.getGuide(integration);
			if (!guide) {
				throw new ApiError(404, `No guide available for integration: ${integration}`);
			}

			res.json({ integration, guide });
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

				// Look up action definition from cached tools
				const tools = await listSessionConnectorTools(sessionId);
				const ct = tools.find((t) => t.connectorId === connectorId);
				const actionDef = ct?.actions.find((a) => a.name === action);
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

			// ── Static adapter path (unchanged) ──

			// Find adapter
			const adapter = actions.getAdapter(integration);
			if (!adapter) {
				throw new ApiError(400, `Unknown integration: ${integration}`);
			}

			// Validate action exists
			const actionDef = adapter.actions.find((a) => a.name === action);
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

					const actionResult = await adapter.execute(action, params ?? {}, token);
					const durationMs = Date.now() - startMs;
					const invocation = await actions.markCompleted(
						result.invocation.id,
						actionResult,
						durationMs,
					);
					res.json({ invocation, result: actionResult });
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

			// Parse optional approval mode from body
			const body = req.body as
				| {
						mode?: string;
						grant?: { scope?: string; maxCalls?: number | null };
				  }
				| undefined;
			const mode = body?.mode ?? "once";
			if (mode !== "once" && mode !== "grant") {
				throw new ApiError(400, `Invalid approval mode: ${mode}`);
			}

			// Approve the invocation (checks status + org + expiry)
			let invocation: Awaited<ReturnType<typeof actions.approveAction>>;
			let grantInfo:
				| { id: string; integration: string; action: string; maxCalls: number | null }
				| undefined;
			try {
				if (mode === "grant") {
					const grantPayload = body?.grant;
					const scope = grantPayload?.scope === "org" ? ("org" as const) : ("session" as const);
					const rawMaxCalls = grantPayload?.maxCalls ?? null;
					if (rawMaxCalls != null && (!Number.isInteger(rawMaxCalls) || rawMaxCalls < 1)) {
						throw new ApiError(400, "grant.maxCalls must be a positive integer or null");
					}
					const maxCalls = rawMaxCalls;
					const result = await actions.approveActionWithGrant(
						invocationId,
						session.organizationId,
						auth.userId,
						{ scope, maxCalls },
					);
					invocation = result.invocation;
					grantInfo = {
						id: result.grant.id,
						integration: result.grant.integration,
						action: result.grant.action,
						maxCalls: result.grant.maxCalls,
					};
				} else {
					invocation = await actions.approveAction(
						invocationId,
						session.organizationId,
						auth.userId,
					);
				}
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

					const adapter = actions.getAdapter(invocation.integration);
					if (!adapter) {
						throw new Error(`No adapter for ${invocation.integration}`);
					}

					const token = await integrations.getToken({
						id: conn.integration.id,
						provider: conn.integration.provider,
						integrationId: conn.integration.integrationId,
						connectionId: conn.integration.connectionId,
						githubInstallationId: conn.integration.githubInstallationId,
					});

					actionResult = await adapter.execute(
						invocation.action,
						(invocation.params as Record<string, unknown>) ?? {},
						token,
					);
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
					...(grantInfo ? { grant: grantInfo } : {}),
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

	// ============================================
	// Grant Management
	// ============================================

	/**
	 * POST /grants — create a scoped action grant.
	 * Auth: sandbox token only (sandbox agents self-create grants).
	 */
	router.post("/grants", async (req, res, next) => {
		try {
			if (req.auth?.source !== "sandbox") {
				throw new ApiError(403, "Only sandbox agents can create grants");
			}

			const sessionId = req.proliferateSessionId!;
			const { integration, action, scope, maxCalls } = req.body as {
				integration?: string;
				action?: string;
				scope?: string;
				maxCalls?: number;
			};

			if (!integration || !action) {
				throw new ApiError(400, "Missing required fields: integration, action");
			}

			if (scope !== undefined && scope !== "session" && scope !== "org") {
				throw new ApiError(400, "scope must be 'session' or 'org'");
			}

			if (maxCalls != null && (!Number.isInteger(maxCalls) || maxCalls < 1)) {
				throw new ApiError(400, "maxCalls must be a positive integer");
			}

			const session = await sessions.findByIdInternal(sessionId);
			if (!session) {
				throw new ApiError(404, "Session not found");
			}
			if (!session.createdBy) {
				throw new ApiError(400, "Cannot create grant: session has no creator user");
			}

			if (!session.createdBy) {
				throw new ApiError(400, "Cannot create grant: session has no owner identity");
			}

			const grant = await actions.createGrant({
				organizationId: session.organizationId,
				createdBy: session.createdBy,
				sessionId: scope === "org" ? null : sessionId,
				integration,
				action,
				maxCalls: maxCalls ?? null,
			});

			res.status(201).json({ grant });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * GET /grants — list active grants for this session.
	 * Auth: sandbox token (session-scoped) or user token (org check).
	 */
	router.get("/grants", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;

			let orgId: string;
			if (req.auth?.source === "sandbox") {
				const session = await sessions.findByIdInternal(sessionId);
				if (!session) {
					throw new ApiError(404, "Session not found");
				}
				orgId = session.organizationId;
			} else {
				const session = await requireSessionOrgAccess(sessionId, req.auth?.orgId);
				orgId = session.organizationId;
			}

			const rawLimit = req.query.limit != null ? Math.floor(Number(req.query.limit)) : 100;
			const rawOffset = req.query.offset != null ? Math.floor(Number(req.query.offset)) : 0;
			if (!Number.isFinite(rawLimit) || rawLimit < 1) {
				throw new ApiError(400, "limit must be a positive integer");
			}
			if (!Number.isFinite(rawOffset) || rawOffset < 0) {
				throw new ApiError(400, "offset must be a non-negative integer");
			}
			const limit = Math.min(rawLimit, 100);
			const grants = await actions.listActiveGrants(orgId, sessionId, { limit, offset: rawOffset });
			res.json({ grants });
		} catch (err) {
			next(err);
		}
	});

	return router;
}
