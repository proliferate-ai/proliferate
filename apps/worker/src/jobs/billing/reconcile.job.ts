/**
 * BullMQ processor: nightly shadow balance reconciliation.
 *
 * Runs daily at 00:00 UTC. Reconciles local shadow balances with Autumn.
 * Per-org errors are isolated — one failure does not abort the entire run.
 */

import type { Logger } from "@proliferate/logger";
import type { Job } from "@proliferate/queue";
import type { BillingReconcileJob } from "@proliferate/queue";
import { billing, orgs } from "@proliferate/services";
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
		let driftWarnings = 0;
		let driftAlerts = 0;
		let driftCritical = 0;
		let totalAbsDrift = 0;

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

				// Update staleness tracker
				await orgs.updateLastReconciledAt(org.id);
				reconciled++;

				// Tiered drift detection
				const absDrift = Math.abs(result.delta);
				totalAbsDrift += absDrift;
				const driftFields = {
					orgId: org.id,
					drift: result.delta,
					previousBalance: result.previousBalance,
					newBalance: result.newBalance,
				};

				if (absDrift > METERING_CONFIG.reconcileDriftCriticalThreshold) {
					driftCritical++;
					reconcileLog.error(
						{ ...driftFields, alert: true, page: true },
						"CRITICAL: Reconciliation drift exceeds critical threshold",
					);
				} else if (absDrift > METERING_CONFIG.reconcileDriftAlertThreshold) {
					driftAlerts++;
					reconcileLog.error(
						{ ...driftFields, alert: true },
						"Reconciliation drift exceeds alert threshold",
					);
				} else if (absDrift > METERING_CONFIG.reconcileDriftWarnThreshold) {
					driftWarnings++;
					reconcileLog.warn(driftFields, "Reconciliation drift exceeds warn threshold");
				} else if (result.delta !== 0) {
					reconcileLog.info(driftFields, "Reconciled org with minor drift");
				} else {
					reconcileLog.debug({ orgId: org.id, actualBalance }, "Reconciled org (no drift)");
				}
			} catch (err) {
				failed++;
				reconcileLog.error({ err, orgId: org.id }, "Failed to reconcile org");
			}
		}

		// Staleness check: flag orgs that weren't in the billable set but should be monitored
		const staleOrgs = await billing.listStaleReconcileOrgs(METERING_CONFIG.reconcileMaxStalenessMs);
		if (staleOrgs.length > 0) {
			reconcileLog.warn(
				{ staleOrgCount: staleOrgs.length, alert: true },
				"Orgs with stale reconciliation detected",
			);
		}

		reconcileLog.info(
			{
				orgCount: orgsToReconcile.length,
				reconciled,
				failed,
				driftWarnings,
				driftAlerts,
				driftCritical,
				totalAbsDrift: Math.round(totalAbsDrift),
				staleOrgs: staleOrgs.length,
			},
			"Nightly reconciliation complete",
		);
	} catch (err) {
		reconcileLog.error({ err }, "Reconciliation job failed");
		throw err;
	}
}
