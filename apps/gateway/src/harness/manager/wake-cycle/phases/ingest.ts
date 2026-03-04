import type { Logger } from "@proliferate/logger";
import { workers } from "@proliferate/services";
import type { RunContext } from "../types";

export async function runIngestPhase(params: {
	ctx: RunContext;
	log: Logger;
	enrichFromWakePayload: (ctx: RunContext, log: Logger) => Promise<string[]>;
}): Promise<string> {
	const { ctx, log, enrichFromWakePayload } = params;
	const parts: string[] = [];

	parts.push("## Wake Event");
	parts.push(`- Source: ${ctx.wakeSource}`);
	parts.push(`- Event ID: ${ctx.wakeEventId}`);
	if (ctx.wakePayload) {
		parts.push(`- Payload:\n\`\`\`json\n${JSON.stringify(ctx.wakePayload, null, 2)}\n\`\`\``);
	}

	if (ctx.workerObjective) {
		parts.push("\n## Coworker Objective");
		parts.push(ctx.workerObjective);
	}

	try {
		const recentEvents = await workers.listWorkerRunEvents(ctx.workerRunId);
		const wakeStarted = recentEvents.find((e) => e.eventType === "wake_started");
		if (wakeStarted?.payloadJson) {
			const payload = wakeStarted.payloadJson as Record<string, unknown>;
			const coalescedIds = payload.coalescedWakeEventIds;
			if (Array.isArray(coalescedIds) && coalescedIds.length > 0) {
				parts.push(
					`\n## Coalesced Events\n${coalescedIds.length} additional wake events were merged into this one.`,
				);
			}
		}
	} catch {
		// Non-critical
	}

	try {
		const pendingDirectives = await workers.listPendingDirectives(ctx.managerSessionId);
		if (pendingDirectives.length > 0) {
			parts.push("\n## Pending Directives");
			for (const d of pendingDirectives) {
				const payload = d.payloadJson as Record<string, unknown>;
				const content = (payload?.content as string) ?? JSON.stringify(payload);
				parts.push(`- ${content}`);
			}
		}
	} catch {
		// Non-critical
	}

	const sourceDataParts = await enrichFromWakePayload(ctx, log);
	if (sourceDataParts.length > 0) {
		parts.push("\n## Source Data");
		parts.push(...sourceDataParts);
	} else {
		parts.push(
			"\n## Source Data\nNo source refs in wake payload. Use list_source_bindings and read_source tools to query external data sources.",
		);
	}

	const ingestContext = parts.join("\n");

	await workers.appendWorkerRunEvent({
		workerRunId: ctx.workerRunId,
		workerId: ctx.workerId,
		eventType: "source_observation",
		summaryText: `Ingested wake event (source: ${ctx.wakeSource})`,
		payloadJson: { phase: "ingest", wakeSource: ctx.wakeSource },
	});

	log.info("Ingest phase completed");
	return ingestContext;
}
