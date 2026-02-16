/**
 * BullMQ processor: per-org LLM spend sync.
 *
 * Processes LLM spend logs for a single organization:
 * 1. Read per-org cursor (or default to 5-min lookback)
 * 2. Fetch spend logs from LiteLLM REST API
 * 3. Convert to BulkDeductEvent[] and bulk-deduct from shadow balance
 * 4. Advance cursor
 * 5. Handle state transitions (terminate sessions if exhausted)
 */

import type { Logger } from "@proliferate/logger";
import type { BillingLLMSyncOrgJob, Job } from "@proliferate/queue";
import { billing } from "@proliferate/services";
import { calculateLLMCredits } from "@proliferate/shared/billing";

/** Default lookback window for first-run orgs with no cursor (5 minutes). */
const LLM_SYNC_DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;

export async function processLLMSyncOrgJob(
	job: Job<BillingLLMSyncOrgJob>,
	logger: Logger,
): Promise<void> {
	const { orgId } = job.data;
	const log = logger.child({ op: "llm-sync-org", orgId });

	// 1. Read cursor
	const cursor = await billing.getLLMSpendCursor(orgId);
	const startDate = cursor
		? cursor.lastStartTime
		: new Date(Date.now() - LLM_SYNC_DEFAULT_LOOKBACK_MS);

	// 2. Fetch spend logs from REST API
	const logs = await billing.fetchSpendLogs(orgId, startDate);
	if (!logs.length) {
		return;
	}

	// 3. Sort logs by startTime ascending for deterministic cursor advancement.
	// LiteLLM's REST API does not guarantee sort order, so we enforce it client-side.
	logs.sort((a, b) => {
		const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
		const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
		if (ta !== tb) return ta - tb;
		return a.request_id.localeCompare(b.request_id);
	});

	// 4. Convert to BulkDeductEvent[]. We do NOT skip duplicates client-side —
	// bulkDeductShadowBalance uses ON CONFLICT (idempotency_key) DO NOTHING,
	// which is the authoritative dedup.
	const events: billing.BulkDeductEvent[] = [];
	for (const entry of logs) {
		if (entry.spend <= 0) continue;

		// TODO: calculateLLMCredits applies a 3× markup — verify this is the desired conversion
		const credits = calculateLLMCredits(entry.spend);
		events.push({
			credits,
			quantity: entry.spend,
			eventType: "llm",
			idempotencyKey: `llm:${entry.request_id}`,
			sessionIds: entry.end_user ? [entry.end_user] : [],
			metadata: {
				model: entry.model,
				total_tokens: entry.total_tokens,
				prompt_tokens: entry.prompt_tokens,
				completion_tokens: entry.completion_tokens,
				litellm_request_id: entry.request_id,
			},
		});
	}

	if (!events.length) {
		return;
	}

	// 5. Bulk deduct
	const result = await billing.bulkDeductShadowBalance(orgId, events);

	log.info(
		{
			fetched: logs.length,
			inserted: result.insertedCount,
			creditsDeducted: result.totalCreditsDeducted,
			balance: result.newBalance,
		},
		"Synced LLM spend",
	);

	// 6. Advance cursor to the last sorted log's startTime.
	const lastLog = logs[logs.length - 1];
	const latestStartTime = lastLog.startTime ? new Date(lastLog.startTime) : startDate;

	await billing.updateLLMSpendCursor({
		organizationId: orgId,
		lastStartTime: latestStartTime,
		lastRequestId: lastLog.request_id,
		recordsProcessed: (cursor?.recordsProcessed ?? 0) + result.insertedCount,
		syncedAt: new Date(),
	});

	// 7. Handle state transitions
	if (result.shouldTerminateSessions) {
		// Check trial auto-activation before terminating (parity with compute metering)
		const activation = await billing.tryActivatePlanAfterTrial(orgId);
		if (activation.activated) {
			log.info("Trial auto-activated via LLM spend; skipping termination");
			return;
		}

		log.info(
			{ enforcementReason: result.enforcementReason },
			"Balance exhausted — pausing sessions",
		);
		await billing.enforceCreditsExhausted(orgId);
	} else if (result.shouldBlockNewSessions) {
		log.info({ enforcementReason: result.enforcementReason }, "Entering grace period");
	}
}
