import { createLogger } from "@proliferate/logger";
import { getProviderActions } from "@proliferate/providers/providers/registry";
import { actions, sessions, userActionPreferences } from "@proliferate/services";
import type { ClientSource } from "@proliferate/shared";
import type { ServerMessage } from "@proliferate/shared";
import { listSessionConnectorTools } from "../../../../api/proliferate/http/session/actions/connector-cache";
import { resolveProviderConnectionsForSession } from "../../../../api/proliferate/http/session/actions/provider-connections";
import { checkInvokeRateLimit } from "../../../../api/proliferate/http/session/actions/rate-limit";
import {
	findIntegrationId,
	resolveActionSource,
} from "../../../../api/proliferate/http/session/actions/resolver";
import { actionToResponse } from "../../../../api/proliferate/http/session/actions/response";
import type { ManagerControlFacade } from "../../../../harness/manager/control-facade";
import { ApiError } from "../../../../server/middleware/errors";
import { projectOperatorStatus, touchLastVisibleUpdate } from "../../../session/session-lifecycle";

const logger = createLogger({ service: "gateway" }).child({
	module: "manager-control-facade",
});

export interface ManagerControlTarget {
	eagerStart(): Promise<void>;
	postPrompt(
		content: string,
		userId: string,
		source?: ClientSource,
		images?: string[],
	): Promise<void>;
	postCancel(): void;
	broadcastMessage?(message: ServerMessage): void;
}

export interface InProcessManagerControlFacadeOptions {
	getOrCreateHub(sessionId: string): Promise<ManagerControlTarget>;
}

export function createInProcessManagerControlFacade(
	options: InProcessManagerControlFacadeOptions,
): ManagerControlFacade {
	return {
		async eagerStartSession(sessionId) {
			const hub = await options.getOrCreateHub(sessionId);
			await hub.eagerStart();
		},

		async sendPromptToSession(input) {
			const hub = await options.getOrCreateHub(input.sessionId);
			await hub.postPrompt(input.content, input.userId, input.source, input.images);
		},

		async cancelSession(sessionId) {
			const hub = await options.getOrCreateHub(sessionId);
			hub.postCancel();
		},

		async listCapabilities(sessionId) {
			const sessionRow = await sessions.findSessionByIdInternal(sessionId);
			if (!sessionRow) {
				throw new Error("Session not found");
			}

			const providerConnections = await resolveProviderConnectionsForSession(sessionId);
			const available = providerConnections.connections.flatMap((entry) => {
				const module = getProviderActions(entry.integration.integrationId);
				if (!module) {
					return [];
				}
				return [
					{
						integrationId: entry.integrationId,
						integration: entry.integration.integrationId,
						displayName: entry.integration.displayName,
						actions: module.actions.map(actionToResponse),
					},
				];
			});

			const connectorTools = await listSessionConnectorTools(sessionId);
			const connectorIntegrations = connectorTools
				.filter((entry) => entry.actions.length > 0)
				.map((entry) => ({
					integrationId: null,
					integration: `connector:${entry.connectorId}`,
					displayName: entry.connectorName,
					actions: entry.actions.map(actionToResponse),
				}));

			const userId = sessionRow.createdBy;
			const capabilityFiltered = await actions.filterAvailableActionsForSession({
				sessionId,
				organizationId: sessionRow.organizationId,
				automationId: sessionRow.automationId ?? undefined,
				userId,
				integrations: [...available, ...connectorIntegrations],
			});

			return { integrations: capabilityFiltered };
		},

		async invokeAction(input) {
			try {
				checkInvokeRateLimit(input.sessionId);

				const session = await sessions.findSessionByIdInternal(input.sessionId);
				if (!session) {
					return { status: 404, body: { error: "Session not found" } };
				}

				if (session.createdBy) {
					const disabled = await userActionPreferences.getDisabledPreferences(
						session.createdBy,
						session.organizationId,
					);
					if (disabled.disabledSourceIds.has(input.integration)) {
						return {
							status: 403,
							body: { error: "This integration is disabled by user preferences" },
						};
					}
					if (disabled.disabledActionsBySource.get(input.integration)?.has(input.action)) {
						return {
							status: 403,
							body: { error: "This action is disabled by user preferences" },
						};
					}
				}

				const resolved = await resolveActionSource(
					input.sessionId,
					input.integration,
					input.action,
				);
				const parseResult = resolved.actionDef.params.safeParse(input.params ?? {});
				if (!parseResult.success) {
					return {
						status: 400,
						body: { error: `Invalid params: ${parseResult.error.message}` },
					};
				}
				const validatedParams = parseResult.data as Record<string, unknown>;

				let invocationResult: Awaited<ReturnType<typeof actions.invokeAction>>;
				try {
					invocationResult = await actions.invokeAction({
						sessionId: input.sessionId,
						organizationId: resolved.ctx.orgId,
						integrationId: input.integration.startsWith("connector:")
							? null
							: await findIntegrationId(input.sessionId, input.integration),
						integration: input.integration,
						action: input.action,
						automationId: session.automationId ?? undefined,
						riskLevel: resolved.actionDef.riskLevel,
						params: validatedParams,
						isDrifted: resolved.isDrifted,
					});
				} catch (error) {
					if (error instanceof actions.PendingLimitError) {
						return { status: 429, body: { error: error.message } };
					}
					throw error;
				}

				if (!invocationResult.needsApproval && invocationResult.invocation.status === "approved") {
					try {
						const execution = await actions.executeApprovedInvocation({
							invocationId: invocationResult.invocation.id,
							execute: () => resolved.source.execute(input.action, validatedParams, resolved.ctx),
						});
						return {
							status: 200,
							body: {
								invocation: actions.toActionInvocation(execution.invocation),
								result: execution.result,
							},
						};
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return { status: 502, body: { error: `Action failed: ${message}` } };
					}
				}

				if (invocationResult.invocation.status === "denied") {
					return {
						status: 403,
						body: {
							invocation: actions.toActionInvocation(invocationResult.invocation),
							error: "Action denied: danger-level actions are not allowed",
						},
					};
				}

				if (invocationResult.needsApproval) {
					const hub = await options.getOrCreateHub(input.sessionId);
					hub.broadcastMessage?.({
						type: "action_approval_request",
						payload: {
							invocationId: invocationResult.invocation.id,
							integration: input.integration,
							action: input.action,
							riskLevel: resolved.actionDef.riskLevel,
							params: validatedParams,
							expiresAt: invocationResult.invocation.expiresAt?.toISOString() ?? "",
						},
					});

					void projectOperatorStatus({
						sessionId: input.sessionId,
						organizationId: session.organizationId,
						runtimeStatus: "running",
						hasPendingApproval: true,
						logger,
					});
					void touchLastVisibleUpdate(input.sessionId, logger);

					return {
						status: 202,
						body: {
							invocation: actions.toActionInvocation(invocationResult.invocation),
							message: "Action requires approval",
						},
					};
				}

				return {
					status: 200,
					body: {
						invocation: actions.toActionInvocation(invocationResult.invocation),
					},
				};
			} catch (error) {
				if (error instanceof ApiError) {
					return { status: error.statusCode, body: { error: error.message } };
				}
				logger.error({ err: error, sessionId: input.sessionId }, "Failed to invoke manager action");
				return { status: 500, body: { error: "Internal action invocation error" } };
			}
		},
	};
}
