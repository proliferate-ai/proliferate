import type { Logger } from "@proliferate/logger";
import { sessions, workers } from "@proliferate/services";
import type { RunContext } from "../types";

export async function runFinalizePhase(params: {
	ctx: RunContext;
	childSessionIds: string[];
	log: Logger;
}): Promise<string> {
	const { ctx, childSessionIds, log } = params;
	const childOutcomes: Array<{
		id: string;
		title: string | null;
		status: string | null;
		outcome: string | null;
	}> = [];

	for (const childId of childSessionIds) {
		const child = await sessions.findSessionById(childId, ctx.organizationId);
		if (child) {
			childOutcomes.push({
				id: child.id,
				title: child.title,
				status: child.status,
				outcome: child.outcome,
			});
		}
	}

	const summaryParts = [`Wake source: ${ctx.wakeSource}`];
	if (childSessionIds.length > 0) {
		summaryParts.push(`Child tasks: ${childSessionIds.length}`);
		for (const co of childOutcomes) {
			summaryParts.push(`  - ${co.title ?? co.id}: ${co.outcome ?? co.status ?? "unknown"}`);
		}
	}
	const summary = summaryParts.join("\n");

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "manager_note",
		summaryText: summary,
		payloadJson: { phase: "finalize", childOutcomes },
	});

	log.info("Finalize phase completed");
	return summary;
}
