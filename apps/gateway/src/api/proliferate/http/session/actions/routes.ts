import { createLogger } from "@proliferate/logger";
import { zodToJsonSchema } from "@proliferate/providers/helpers/schema";
import { getProviderActions } from "@proliferate/providers/providers/registry";
import { actions, sessions, userActionPreferences } from "@proliferate/services";
import { Router, type Router as RouterType } from "express";
import type { HubManager } from "../../../../../hub";
import {
	projectOperatorStatus,
	touchLastVisibleUpdate,
} from "../../../../../hub/session/session-lifecycle";
import { ApiError } from "../../../../../server/middleware/errors";
import { isOrgAdmin, requireSessionOrgAccess } from "./authz";
import { listSessionConnectorTools } from "./connector-cache";
import { resolveProviderConnectionsForSession } from "./provider-connections";
import { checkInvokeRateLimit } from "./rate-limit";
import { findIntegrationId, resolveActionSource } from "./resolver";
import { actionToResponse, mapActionExecutionError, mapActionMutationError } from "./response";

const logger = createLogger({ service: "gateway" }).child({ module: "actions" });

export function createActionsRoutes(hubManager: HubManager): RouterType {
	const router: RouterType = Router({ mergeParams: true });

	router.use((req, _res, next) => {
		req.proliferateSessionId = req.params.proliferateSessionId;
		next();
	});

	async function tryGetHub(sessionId: string) {
		try {
			return await hubManager.getOrCreate(sessionId);
		} catch {
			return null;
		}
	}

	router.get("/available", async (req, res, next) => {
		try {
			logger.debug({
				msg: "Searching for available actions",
				route: "/available",
				params: req.params,
				proliferateSessionId: req.proliferateSessionId,
			});

			const sessionId = req.proliferateSessionId!;
			logger.debug({ msg: "Fetching session row", sessionId });
			const sessionRow = await sessions.findSessionByIdInternal(sessionId);
			if (!sessionRow) {
				logger.warn({ msg: "Session not found", sessionId });
				throw new ApiError(404, "Session not found");
			}

			if (req.auth?.source !== "sandbox" && req.auth?.source !== "service") {
				logger.debug({ msg: "Requiring session org access", sessionId, orgId: req.auth?.orgId });
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}

			logger.debug({ msg: "Listing provider connections", sessionId });
			const providerConnections = await resolveProviderConnectionsForSession(sessionId);
			logger.debug({
				msg: "Found provider connections",
				connectionsCount: providerConnections.connections.length,
				source: providerConnections.source,
			});

			const available = providerConnections.connections.flatMap((entry) => {
				const module = getProviderActions(entry.integration.integrationId);
				if (!module) {
					logger.debug({
						msg: "No module found for provider actions",
						integrationId: entry.integration.integrationId,
					});
					return [];
				}
				const actionsResponse = module.actions.map(actionToResponse);
				logger.debug({
					msg: "Adding available integration",
					integrationId: entry.integration.integrationId,
					displayName: entry.integration.displayName,
					actionsCount: actionsResponse.length,
				});
				return [
					{
						integrationId: entry.integrationId,
						integration: entry.integration.integrationId,
						displayName: entry.integration.displayName,
						actions: actionsResponse,
					},
				];
			});

			logger.debug({ msg: "Listing connector tools", sessionId });
			const connectorTools = await listSessionConnectorTools(sessionId);

			logger.debug({ msg: "Mapping connector tool actions", toolsCount: connectorTools.length });
			const connectorIntegrations = connectorTools
				.filter((entry) => {
					const hasActions = entry.actions.length > 0;
					if (!hasActions) {
						logger.debug({
							msg: "Skipping connector tool with no actions",
							connectorId: entry.connectorId,
						});
					}
					return hasActions;
				})
				.map((entry) => {
					const actionsResponse = entry.actions.map(actionToResponse);
					logger.debug({
						msg: "Adding connector integration",
						connectorId: entry.connectorId,
						connectorName: entry.connectorName,
						actionsCount: actionsResponse.length,
					});
					return {
						integrationId: null,
						integration: `connector:${entry.connectorId}`,
						displayName: entry.connectorName,
						actions: actionsResponse,
					};
				});

			const userId = req.auth?.source !== "sandbox" ? req.auth?.userId : sessionRow.createdBy;
			logger.debug({
				msg: "Filtering available actions for session",
				userId,
				sessionId,
				organizationId: sessionRow.organizationId,
				integrationsCount: available.length + connectorIntegrations.length,
			});

			const capabilityFiltered = await actions.filterAvailableActionsForSession({
				sessionId,
				organizationId: sessionRow.organizationId,
				automationId: sessionRow.automationId ?? undefined,
				userId,
				integrations: [...available, ...connectorIntegrations],
			});

			logger.debug({
				msg: "Returning available integrations",
				integrationsCount: capabilityFiltered.length,
			});
			res.json({ integrations: capabilityFiltered });
		} catch (error) {
			logger.error({
				msg: "Error in /available route",
				error,
				params: req.params,
				proliferateSessionId: req.proliferateSessionId,
			});
			next(error);
		}
	});

	router.get("/guide/:integration", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;
			if (req.auth?.source !== "sandbox" && req.auth?.source !== "service") {
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}

			const { integration } = req.params;
			if (integration.startsWith("connector:")) {
				const connectorId = integration.slice("connector:".length);
				const tools = await listSessionConnectorTools(sessionId);
				const connectorTools = tools.find((entry) => entry.connectorId === connectorId);
				if (!connectorTools || connectorTools.actions.length === 0) {
					throw new ApiError(404, `No guide available for connector: ${connectorId}`);
				}

				const lines = [
					`# ${connectorTools.connectorName} (MCP Connector)`,
					"",
					"## Available Actions",
					"",
				];
				for (const actionDef of connectorTools.actions) {
					lines.push(`### ${actionDef.id} (${actionDef.riskLevel})`);
					lines.push(actionDef.description);
					const schema = zodToJsonSchema(actionDef.params);
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

			const module = getProviderActions(integration);
			if (!module?.guide) {
				throw new ApiError(404, `No guide available for integration: ${integration}`);
			}

			res.json({ integration, guide: module.guide });
		} catch (error) {
			next(error);
		}
	});

	router.post("/invoke", async (req, res, next) => {
		try {
			if (req.auth?.source !== "sandbox" && req.auth?.source !== "service") {
				throw new ApiError(403, "Only sandbox agents can invoke actions");
			}

			const sessionId = req.proliferateSessionId!;
			checkInvokeRateLimit(sessionId);

			const { integration, action, params } = req.body as {
				integration: string;
				action: string;
				params: Record<string, unknown>;
			};
			if (!integration || !action) {
				throw new ApiError(400, "Missing integration or action");
			}

			const session = await sessions.findSessionByIdInternal(sessionId);
			if (!session) throw new ApiError(404, "Session not found");

			if (session.createdBy) {
				const disabled = await userActionPreferences.getDisabledPreferences(
					session.createdBy,
					session.organizationId,
				);
				if (disabled.disabledSourceIds.has(integration)) {
					throw new ApiError(403, "This integration is disabled by user preferences");
				}
				const disabledActions = disabled.disabledActionsBySource.get(integration);
				if (disabledActions?.has(action)) {
					throw new ApiError(403, "This action is disabled by user preferences");
				}
			}

			const resolved = await resolveActionSource(sessionId, integration, action);
			const parseResult = resolved.actionDef.params.safeParse(params ?? {});
			if (!parseResult.success) {
				throw new ApiError(400, `Invalid params: ${parseResult.error.message}`);
			}
			const validatedParams = parseResult.data as Record<string, unknown>;

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
					automationId: session.automationId ?? undefined,
					riskLevel: resolved.actionDef.riskLevel,
					params: validatedParams,
					isDrifted: resolved.isDrifted,
				});
			} catch (error) {
				if (error instanceof actions.PendingLimitError) {
					throw new ApiError(429, error.message);
				}
				throw error;
			}

			if (!result.needsApproval && result.invocation.status === "approved") {
				try {
					const execution = await actions.executeApprovedInvocation({
						invocationId: result.invocation.id,
						execute: () => resolved.source.execute(action, validatedParams, resolved.ctx),
					});
					res.json({
						invocation: actions.toActionInvocation(execution.invocation),
						result: execution.result,
					});
				} catch (error) {
					logger.error(
						{ err: error, invocationId: result.invocation.id },
						"Action execution failed",
					);
					mapActionExecutionError(error);
				}
				return;
			}

			if (result.invocation.status === "denied") {
				res.status(403).json({
					invocation: actions.toActionInvocation(result.invocation),
					error: "Action denied: danger-level actions are not allowed",
				});
				return;
			}

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

				void projectOperatorStatus({
					sessionId,
					organizationId: session.organizationId,
					runtimeStatus: "running",
					hasPendingApproval: true,
					logger,
				});
				void touchLastVisibleUpdate(sessionId, logger);

				res.status(202).json({
					invocation: actions.toActionInvocation(result.invocation),
					message: "Action requires approval",
				});
				return;
			}

			res.json({ invocation: actions.toActionInvocation(result.invocation) });
		} catch (error) {
			next(error);
		}
	});

	router.get("/invocations/:invocationId", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;
			const { invocationId } = req.params;

			if (req.auth?.source === "sandbox") {
				const bySession = await actions.listSessionActions(sessionId);
				const found = bySession.find((entry) => entry.id === invocationId);
				if (!found) {
					throw new ApiError(404, "Invocation not found");
				}
				res.json({ invocation: actions.toActionInvocation(found) });
				return;
			}

			const session = await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			const invocation = await actions.getActionStatus(invocationId, session.organizationId);
			if (!invocation) {
				throw new ApiError(404, "Invocation not found");
			}
			res.json({ invocation: actions.toActionInvocation(invocation) });
		} catch (error) {
			next(error);
		}
	});

	router.post("/invocations/:invocationId/approve", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth?.userId) {
				throw new ApiError(401, "User authentication required for approvals");
			}

			const { invocationId } = req.params;
			const session = await requireSessionOrgAccess(req.proliferateSessionId!, auth.orgId);
			const targetInvocation = await actions.getActionStatus(invocationId, session.organizationId);
			if (!targetInvocation || targetInvocation.sessionId !== req.proliferateSessionId) {
				throw new ApiError(404, "Invocation not found");
			}

			const adminOverride = await isOrgAdmin(auth.userId, session.organizationId);
			await actions.assertApprovalAuthority({
				sessionId: targetInvocation.sessionId,
				organizationId: session.organizationId,
				userId: auth.userId,
				isOrgAdmin: adminOverride,
			});

			const invocation = await actions.approveAction(
				invocationId,
				session.organizationId,
				auth.userId,
			);
			const resolved = await resolveActionSource(
				invocation.sessionId,
				invocation.integration,
				invocation.action,
			);

			try {
				const execution = await actions.executeApprovedInvocation({
					invocationId,
					execute: () =>
						resolved.source.execute(
							invocation.action,
							(invocation.params as Record<string, unknown>) ?? {},
							resolved.ctx,
						),
				});

				const hub = await tryGetHub(invocation.sessionId);
				hub?.broadcastMessage({
					type: "action_completed",
					payload: {
						invocationId,
						status: "completed",
						result: execution.result,
					},
				});

				res.json({
					invocation: actions.toActionInvocation(execution.invocation),
					result: execution.result,
				});

				void touchLastVisibleUpdate(invocation.sessionId, logger);
				void projectOperatorStatus({
					sessionId: invocation.sessionId,
					organizationId: session.organizationId,
					runtimeStatus: "running",
					hasPendingApproval: false,
					logger,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const hub = await tryGetHub(invocation.sessionId);
				hub?.broadcastMessage({
					type: "action_completed",
					payload: {
						invocationId,
						status: "failed",
						error: message,
					},
				});

				void touchLastVisibleUpdate(invocation.sessionId, logger);
				void projectOperatorStatus({
					sessionId: invocation.sessionId,
					organizationId: session.organizationId,
					runtimeStatus: "running",
					hasPendingApproval: false,
					logger,
				});

				logger.error({ err: error, invocationId }, "Action execution failed after approval");
				mapActionExecutionError(error);
			}
		} catch (error) {
			try {
				mapActionMutationError(error);
			} catch (mapped) {
				next(mapped);
			}
		}
	});

	router.post("/invocations/:invocationId/deny", async (req, res, next) => {
		try {
			const auth = req.auth;
			if (!auth?.userId) {
				throw new ApiError(401, "User authentication required for denials");
			}

			const { invocationId } = req.params;
			const session = await requireSessionOrgAccess(req.proliferateSessionId!, auth.orgId);
			const targetInvocation = await actions.getActionStatus(invocationId, session.organizationId);
			if (!targetInvocation || targetInvocation.sessionId !== req.proliferateSessionId) {
				throw new ApiError(404, "Invocation not found");
			}

			const adminOverride = await isOrgAdmin(auth.userId, session.organizationId);
			await actions.assertApprovalAuthority({
				sessionId: targetInvocation.sessionId,
				organizationId: session.organizationId,
				userId: auth.userId,
				isOrgAdmin: adminOverride,
			});

			const invocation = await actions.denyAction(
				invocationId,
				session.organizationId,
				auth.userId,
			);
			const hub = await tryGetHub(invocation.sessionId);
			hub?.broadcastMessage({
				type: "action_approval_result",
				payload: {
					invocationId,
					status: "denied",
					approvedBy: auth.userId,
				},
			});

			void touchLastVisibleUpdate(invocation.sessionId, logger);
			void projectOperatorStatus({
				sessionId: invocation.sessionId,
				organizationId: session.organizationId,
				runtimeStatus: "running",
				hasPendingApproval: false,
				logger,
			});

			res.json({ invocation: actions.toActionInvocation(invocation) });
		} catch (error) {
			try {
				mapActionMutationError(error);
			} catch (mapped) {
				next(mapped);
			}
		}
	});

	router.get("/invocations", async (req, res, next) => {
		try {
			const sessionId = req.proliferateSessionId!;
			if (req.auth?.source !== "sandbox") {
				await requireSessionOrgAccess(sessionId, req.auth?.orgId);
			}
			const invocations = await actions.listSessionActions(sessionId);
			res.json({ invocations: actions.toActionInvocations(invocations) });
		} catch (error) {
			next(error);
		}
	});

	return router;
}
