/**
 * Actions Routes
 *
 * HTTP API for agent-initiated external actions (Sentry, Linear, etc.).
 * Sandbox agents call invoke/status; users call approve/deny.
 *
 * Routes (all under /:proliferateSessionId/actions/):
 *   GET  /available            — list available integrations + actions
 *   POST /invoke               — invoke an action
 *   GET  /invocations/:id      — poll invocation status
 *   POST /invocations/:id/approve — approve a pending write
 *   POST /invocations/:id/deny    — deny a pending write
 *   GET  /invocations          — list invocations for this session
 */

import { createLogger } from "@proliferate/logger";
import { actions, integrations, sessions } from "@proliferate/services";
import { Router, type Router as RouterType } from "express";
import type { GatewayEnv } from "../../../lib/env";
import { ApiError } from "../../../middleware";

const logger = createLogger({ service: "gateway" }).child({ module: "actions" });

// ============================================
// Rate Limiting (in-memory, per session)
// ============================================

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 invocations per minute per session
const MAX_PENDING_PER_SESSION = 10;

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
// Router
// ============================================

export function createActionsRouter(_env: GatewayEnv): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	// Set proliferateSessionId from URL params (actions routes skip ensureSessionReady)
	router.use((req, _res, next) => {
		req.proliferateSessionId = req.params.proliferateSessionId;
		next();
	});

	/**
	 * GET /available — list available integrations + actions for this session.
	 * Auth: sandbox token or user token.
	 */
	router.get("/available", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;
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

			res.json({ integrations: available });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * POST /invoke — invoke an action.
	 * Auth: sandbox token (agent calling from sandbox).
	 */
	router.post("/invoke", async (req, res, next) => {
		try {
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

			// Check pending approval limit for write actions
			if (actionDef.riskLevel === "write") {
				const pending = await actions.listPendingActions(sessionId);
				if (pending.length >= MAX_PENDING_PER_SESSION) {
					throw new ApiError(429, "Too many pending approvals. Resolve existing ones first.");
				}
			}

			// Create invocation (risk-based policy)
			const result = await actions.invokeAction({
				sessionId,
				organizationId: session.organizationId,
				integrationId: conn.integrationId,
				integration,
				action,
				riskLevel: actionDef.riskLevel,
				params: params ?? {},
			});

			// Auto-approved reads: execute immediately
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

			// Pending approval (write)
			if (result.needsApproval) {
				// Broadcast approval request to connected WebSocket clients
				if (req.hub) {
					req.hub.broadcastMessage({
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
				}

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
	 * Auth: sandbox token or user token.
	 */
	router.get("/invocations/:invocationId", async (req, res, next) => {
		try {
			const { invocationId } = req.params;
			const invocation = await actions.getActionStatus(invocationId, req.auth?.orgId || "");
			if (!invocation) {
				// Also try by ID only (for sandbox callers who don't have orgId)
				const byId = await actions.listSessionActions(req.proliferateSessionId!);
				const found = byId.find((i) => i.id === invocationId);
				if (!found) {
					throw new ApiError(404, "Invocation not found");
				}
				res.json({ invocation: found });
				return;
			}
			res.json({ invocation });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * POST /invocations/:invocationId/approve — approve a pending write.
	 * Auth: user token only (JWT or CLI).
	 */
	router.post("/invocations/:invocationId/approve", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth?.userId) {
				throw new ApiError(401, "User authentication required for approvals");
			}

			const { invocationId } = req.params;
			const session = await sessions.findByIdInternal(req.proliferateSessionId!);
			if (!session) {
				throw new ApiError(404, "Session not found");
			}

			// Approve the invocation
			const invocation = await actions.approveAction(
				invocationId,
				session.organizationId,
				auth.userId,
			);

			// Execute the action immediately after approval
			const startMs = Date.now();
			try {
				await actions.markExecuting(invocationId);

				// Resolve session connections to find the integration
				const connections = await sessions.listSessionConnections(session.id);
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

				const actionResult = await adapter.execute(
					invocation.action,
					(invocation.params as Record<string, unknown>) ?? {},
					token,
				);
				const durationMs = Date.now() - startMs;
				const completed = await actions.markCompleted(invocationId, actionResult, durationMs);

				// Broadcast completion
				if (req.hub) {
					req.hub.broadcastMessage({
						type: "action_completed",
						payload: {
							invocationId,
							status: "completed",
							result: actionResult,
						},
					});
				}

				res.json({ invocation: completed, result: actionResult });
			} catch (err) {
				const durationMs = Date.now() - startMs;
				const errorMsg = err instanceof Error ? err.message : String(err);
				await actions.markFailed(invocationId, errorMsg, durationMs);

				if (req.hub) {
					req.hub.broadcastMessage({
						type: "action_completed",
						payload: {
							invocationId,
							status: "failed",
							error: errorMsg,
						},
					});
				}

				logger.error({ err, invocationId }, "Action execution failed after approval");
				throw new ApiError(502, `Action failed: ${errorMsg}`);
			}
		} catch (err) {
			next(err);
		}
	});

	/**
	 * POST /invocations/:invocationId/deny — deny a pending write.
	 * Auth: user token only (JWT or CLI).
	 */
	router.post("/invocations/:invocationId/deny", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth?.userId) {
				throw new ApiError(401, "User authentication required for denials");
			}

			const { invocationId } = req.params;
			const session = await sessions.findByIdInternal(req.proliferateSessionId!);
			if (!session) {
				throw new ApiError(404, "Session not found");
			}

			const invocation = await actions.denyAction(
				invocationId,
				session.organizationId,
				auth.userId,
			);

			// Broadcast denial
			if (req.hub) {
				req.hub.broadcastMessage({
					type: "action_approval_result",
					payload: {
						invocationId,
						status: "denied",
						approvedBy: auth.userId,
					},
				});
			}

			res.json({ invocation });
		} catch (err) {
			next(err);
		}
	});

	/**
	 * GET /invocations — list all invocations for this session.
	 * Auth: sandbox token or user token.
	 */
	router.get("/invocations", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;
			const invocations = await actions.listSessionActions(sessionId);
			res.json({ invocations });
		} catch (err) {
			next(err);
		}
	});

	return router;
}
