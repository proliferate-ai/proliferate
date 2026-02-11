/**
 * Notification service.
 *
 * Enqueues outbox items for run terminal transitions.
 */

import { enqueueOutbox } from "../outbox/service";

const TERMINAL_STATUSES = ["succeeded", "failed", "timed_out", "needs_human"];

export async function enqueueRunNotification(
	organizationId: string,
	runId: string,
	status: string,
): Promise<void> {
	if (!TERMINAL_STATUSES.includes(status)) return;

	await enqueueOutbox({
		organizationId,
		kind: "notify_run_terminal",
		payload: { runId, status },
	});
}
