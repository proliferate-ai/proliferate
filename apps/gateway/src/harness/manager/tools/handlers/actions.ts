import type { Logger } from "@proliferate/logger";
import { workers } from "@proliferate/services";
import { getServiceJwt } from "../auth";
import type { ManagerToolContext } from "../types";

export async function handleListCapabilities(
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	try {
		if (ctx.controlFacade?.listCapabilities) {
			const data = await ctx.controlFacade.listCapabilities(ctx.managerSessionId);
			log.debug("Listed capabilities");
			return JSON.stringify(data);
		}
		const jwt = await getServiceJwt(ctx);
		const res = await fetch(
			`${ctx.gatewayUrl}/proliferate/${ctx.managerSessionId}/actions/available`,
			{
				headers: {
					Authorization: `Bearer ${jwt}`,
				},
			},
		);
		if (!res.ok) {
			return JSON.stringify({ error: `Failed to list capabilities: ${res.status}` });
		}
		const data = await res.json();
		log.debug("Listed capabilities");
		return JSON.stringify(data);
	} catch (err) {
		return JSON.stringify({ error: `Capabilities request failed: ${String(err)}` });
	}
}

export async function handleInvokeAction(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const integration = args.integration as string;
	const action = args.action as string;
	const params = (args.params as Record<string, unknown>) ?? {};

	try {
		if (ctx.controlFacade?.invokeAction) {
			const result = await ctx.controlFacade.invokeAction({
				sessionId: ctx.managerSessionId,
				integration,
				action,
				params,
			});
			const eventType =
				result.status === 202
					? "action_pending_approval"
					: result.status >= 200 && result.status < 300
						? "action_completed"
						: "action_failed";
			await workers.appendWorkerRunEvent({
				workerRunId: ctx.workerRunId,
				workerId: ctx.workerId,
				eventType,
				summaryText: `${integration}:${action}`,
				payloadJson: { integration, action, status: result.status },
			});
			log.info({ integration, action, status: result.status }, "Action invocation result");
			return JSON.stringify(result.body);
		}

		const jwt = await getServiceJwt(ctx);
		const res = await fetch(
			`${ctx.gatewayUrl}/proliferate/${ctx.managerSessionId}/actions/invoke`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${jwt}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ integration, action, params }),
			},
		);

		const data = await res.json();
		const eventType =
			res.status === 202
				? "action_pending_approval"
				: res.ok
					? "action_completed"
					: "action_failed";
		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType,
			summaryText: `${integration}:${action}`,
			payloadJson: { integration, action, status: res.status },
		});

		log.info({ integration, action, status: res.status }, "Action invocation result");
		return JSON.stringify(data);
	} catch (err) {
		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "action_failed",
			summaryText: `${integration}:${action} - request error`,
			payloadJson: { integration, action, error: String(err) },
		});
		return JSON.stringify({ error: `Action invocation failed: ${String(err)}` });
	}
}
