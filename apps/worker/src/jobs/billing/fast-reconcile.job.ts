/**
 * BullMQ processor: fast shadow balance reconciliation.
 *
 * On-demand job triggered by auto-top-up, payment webhooks, outbox denial, etc.
 * Reconciles a single org's shadow balance with Autumn (< 5 min SLO).
 */

import type { Logger } from "@proliferate/logger";
import type { BillingFastReconcileJob, Job } from "@proliferate/queue";
import { billing, orgs } from "@proliferate/services";
import { AUTUMN_FEATURES, METERING_CONFIG, autumnGetBalance } from "@proliferate/shared/billing";

export async function processFastReconcileJob(
	job: Job<BillingFastReconcileJob>,
	logger: Logger,
): Promise<void> {
	const { orgId, trigger } = job.data;
	const log = logger.child({ op: "fast-reconcile", orgId, trigger });

	// 1. Load org's Autumn customer ID
	const billingInfo = await orgs.getBillingInfoV2(orgId);
	if (!billingInfo?.autumnCustomerId) {
		log.debug("No Autumn customer ID — skipping");
		return;
	}

	// 2. Fetch actual balance from Autumn
	const { balance: actualBalance } = await autumnGetBalance(
		billingInfo.autumnCustomerId,
		AUTUMN_FEATURES.credits,
	);

	// 3. Reconcile shadow balance
	const result = await billing.reconcileShadowBalance(
		orgId,
		actualBalance,
		"fast_reconcile",
		`Fast reconcile (trigger: ${trigger})`,
	);

	// 4. Update last_reconciled_at
	await orgs.updateLastReconciledAt(orgId);

	// 5. Tiered drift detection (consistent with nightly reconcile)
	const absDrift = Math.abs(result.delta);
	const driftFields = {
		drift: result.delta,
		previousBalance: result.previousBalance,
		newBalance: result.newBalance,
	};

	if (absDrift > METERING_CONFIG.reconcileDriftCriticalThreshold) {
		log.error(
			{ ...driftFields, alert: true, page: true },
			"CRITICAL: Fast reconcile drift exceeds critical threshold",
		);
	} else if (absDrift > METERING_CONFIG.reconcileDriftAlertThreshold) {
		log.error({ ...driftFields, alert: true }, "Fast reconcile drift exceeds alert threshold");
	} else if (absDrift > METERING_CONFIG.reconcileDriftWarnThreshold) {
		log.warn(driftFields, "Fast reconcile drift exceeds warn threshold");
	} else if (result.delta !== 0) {
		log.info(driftFields, "Fast reconcile applied drift correction");
	} else {
		log.debug({ actualBalance }, "Fast reconcile — no drift");
	}
}
