/**
 * BullMQ processor: nightly shadow balance reconciliation.
 *
 * Runs daily at 00:00 UTC. Reconciles local shadow balances with Autumn.
 */

import type { Logger } from "@proliferate/logger";
import type { Job } from "@proliferate/queue";
import type { BillingReconcileJob } from "@proliferate/queue";
import { billing } from "@proliferate/services";
import { AUTUMN_FEATURES, autumnGetBalance } from "@proliferate/shared/billing";

// TODO: wire up from feat/billing-data-layer-rest-bulk after merge
async function listOrgsForReconciliation(): Promise<
	{ id: string; autumnCustomerId: string }[]
> {
	return [];
}

export async function processReconcileJob(
	_job: Job<BillingReconcileJob>,
	logger: Logger,
): Promise<void> {
	const reconcileLog = logger.child({ op: "reconcile" });

	try {
		const orgsToReconcile = await listOrgsForReconciliation();
		if (!orgsToReconcile.length) {
			reconcileLog.debug("No orgs to reconcile");
			return;
		}

		reconcileLog.info({ orgCount: orgsToReconcile.length }, "Starting nightly reconciliation");

		for (const org of orgsToReconcile) {
			try {
				const { balance: actualBalance } = await autumnGetBalance(
					org.autumnCustomerId,
					AUTUMN_FEATURES.credits,
				);
				await billing.reconcileShadowBalance(
					org.id,
					actualBalance,
					"shadow_sync",
					"Nightly reconciliation",
				);
				reconcileLog.debug({ orgId: org.id, actualBalance }, "Reconciled org");
			} catch (err) {
				reconcileLog.error({ err, orgId: org.id }, "Failed to reconcile org");
			}
		}

		reconcileLog.info({ orgCount: orgsToReconcile.length }, "Nightly reconciliation complete");
	} catch (err) {
		reconcileLog.error({ err }, "Reconciliation job failed");
		throw err;
	}
}
