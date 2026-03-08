import type { Logger } from "@proliferate/logger";
import { workers } from "@proliferate/services";
import type { ManagerToolContext } from "../types";

export async function handleSendNotification(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const message = args.message as string;
	const severity = (args.severity as string) ?? "info";

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "manager_note",
		summaryText: message,
		payloadJson: { severity, type: "notification" },
	});

	log.info({ severity, messageLength: message.length }, "Notification sent");
	return JSON.stringify({ ok: true, delivered_as: "run_event" });
}

export async function handleRequestApproval(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const description = args.description as string;

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "action_pending_approval",
		summaryText: description,
		payloadJson: { type: "manager_approval_request", description },
	});

	log.info({ descriptionLength: description.length }, "Approval requested");
	return JSON.stringify({
		ok: true,
		status: "pending",
		note: "Approval request recorded. Approval UI is implemented in Phase H.",
	});
}

export async function handleSkipRun(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const reason = args.reason as string;

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "triage_summary",
		summaryText: `Skipped: ${reason}`,
		payloadJson: { decision: "skip", reason },
	});

	await workers.completeWorkerRun({
		workerRunId: ctx.workerRunId,
		organizationId: ctx.organizationId,
		summary: `Skipped: ${reason}`,
		result: "skipped",
	});

	// Consume pending directives so they don't remain in the queue
	const consumed = await workers.consumePendingDirectives(ctx.managerSessionId);
	if (consumed > 0) {
		log.info({ consumed }, "Consumed pending directives after skip_run");
	}

	log.info({ reason }, "Run skipped");
	return JSON.stringify({ ok: true, outcome: "skipped", reason });
}

export async function handleCompleteRun(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const summary = typeof args.summary === "string" ? args.summary : undefined;

	await workers.completeWorkerRun({
		workerRunId: ctx.workerRunId,
		organizationId: ctx.organizationId,
		summary,
	});

	// Consume pending directives so they don't remain in the queue
	const consumed = await workers.consumePendingDirectives(ctx.managerSessionId);
	if (consumed > 0) {
		log.info({ consumed }, "Consumed pending directives after complete_run");
	}

	log.info({ summaryLength: summary?.length ?? 0 }, "Run completed");
	return JSON.stringify({ ok: true, outcome: "completed", summary });
}
