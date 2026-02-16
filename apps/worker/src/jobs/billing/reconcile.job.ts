/**
 * BullMQ processor: nightly shadow balance reconciliation.
 *
 * Runs daily at 00:00 UTC. Reconciles local shadow balances with Autumn.
 * Per-org errors are isolated — one failure does not abort the entire run.
 */

import type { Logger } from "@proliferate/logger";
import type { Job } from "@proliferate/queue";
import type { BillingReconcileJob } from "@proliferate/queue";
import { billing } from "@proliferate/services";
import { AUTUMN_FEATURES, METERING_CONFIG, autumnGetBalance } from "@proliferate/shared/billing";

export async function processReconcileJob(
	_job: Job<BillingReconcileJob>,
	logger: Logger,
): Promise<void> {
	const reconcileLog = logger.child({ op: "reconcile" });

	try {
		const orgsToReconcile = await billing.listBillableOrgsWithCustomerId();
		if (!orgsToReconcile.length) {
			reconcileLog.debug("No orgs to reconcile");
			return;
		}

		reconcileLog.info({ orgCount: orgsToReconcile.length }, "Starting nightly reconciliation");

		let reconciled = 0;
		let failed = 0;
		let driftAlerts = 0;

		for (const org of orgsToReconcile) {
			try {
				const { balance: actualBalance } = await autumnGetBalance(
					org.autumnCustomerId,
					AUTUMN_FEATURES.credits,
				);
				const result = await billing.reconcileShadowBalance(
					org.id,
					actualBalance,
					"shadow_sync",
					"Nightly reconciliation",
				);

				reconciled++;

				// Drift detection: alert if absolute drift exceeds threshold
				const absDrift = Math.abs(result.delta);
				if (absDrift > METERING_CONFIG.reconcileDriftAlertThreshold) {
					driftAlerts++;
					reconcileLog.error(
						{
							orgId: org.id,
							drift: result.delta,
							previousBalance: result.previousBalance,
							newBalance: result.newBalance,
							alert: true,
						},
						"Reconciliation drift exceeds threshold",
					);
				} else if (result.delta !== 0) {
					reconcileLog.info(
						{
							orgId: org.id,
							drift: result.delta,
							previousBalance: result.previousBalance,
							newBalance: result.newBalance,
						},
						"Reconciled org with drift",
					);
				} else {
					reconcileLog.debug({ orgId: org.id, actualBalance }, "Reconciled org (no drift)");
				}
			} catch (err) {
				failed++;
				reconcileLog.error({ err, orgId: org.id }, "Failed to reconcile org");
			}
		}

		reconcileLog.info(
			{ orgCount: orgsToReconcile.length, reconciled, failed, driftAlerts },
			"Nightly reconciliation complete",
		);
	} catch (err) {
		reconcileLog.error({ err }, "Reconciliation job failed");
		throw err;
	}
}
