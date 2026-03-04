import type { Logger } from "@proliferate/logger";
import { sourceReads, workers } from "@proliferate/services";
import type { ManagerToolContext } from "../../wake-cycle/types";

export async function handleReadSource(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const bindingId = args.binding_id as string;
	const cursor = args.cursor as string | undefined;
	const limit = args.limit as number | undefined;

	try {
		const result = await sourceReads.querySource(bindingId, ctx.organizationId, cursor, limit);

		for (const item of result.items) {
			await workers.appendWorkerRunEvent({
				workerRunId: ctx.workerRunId,
				workerId: ctx.workerId,
				eventType: "source_observation",
				summaryText: item.title,
				payloadJson: {
					sourceType: item.sourceType,
					sourceRef: item.sourceRef,
					severity: item.severity,
				},
				dedupeKey: `source:${item.sourceType}:${item.sourceRef}`,
			});
		}

		log.info({ bindingId, itemCount: result.items.length }, "Source read completed");
		return JSON.stringify(result);
	} catch (err) {
		if (err instanceof sourceReads.BindingNotFoundError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		if (err instanceof sourceReads.CredentialMissingError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		return JSON.stringify({ error: `Source read failed: ${String(err)}` });
	}
}

export async function handleGetSourceItem(
	args: Record<string, unknown>,
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	const bindingId = args.binding_id as string;
	const itemRef = args.item_ref as string;

	try {
		const item = await sourceReads.getSourceItem(bindingId, ctx.organizationId, itemRef);
		if (!item) {
			return JSON.stringify({ error: "Source item not found" });
		}

		await workers.appendWorkerRunEvent({
			workerRunId: ctx.workerRunId,
			workerId: ctx.workerId,
			eventType: "source_observation",
			summaryText: item.title,
			payloadJson: {
				sourceType: item.sourceType,
				sourceRef: item.sourceRef,
				severity: item.severity,
			},
			dedupeKey: `source:${item.sourceType}:${item.sourceRef}`,
		});

		log.info({ bindingId, itemRef }, "Source item retrieved");
		return JSON.stringify({ item });
	} catch (err) {
		if (err instanceof sourceReads.BindingNotFoundError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		if (err instanceof sourceReads.CredentialMissingError) {
			return JSON.stringify({ error: err.message, code: err.code });
		}
		return JSON.stringify({ error: `Source item read failed: ${String(err)}` });
	}
}

export async function handleListSourceBindings(
	ctx: ManagerToolContext,
	log: Logger,
): Promise<string> {
	try {
		const bindings = await sourceReads.listBindings(ctx.workerId, ctx.organizationId);
		log.debug({ count: bindings.length }, "Listed source bindings");
		return JSON.stringify({ bindings });
	} catch (err) {
		return JSON.stringify({ error: `Failed to list bindings: ${String(err)}` });
	}
}
