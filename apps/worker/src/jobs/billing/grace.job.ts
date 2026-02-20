/**
 * BullMQ processor: grace expiration.
 *
 * Runs every 60s. Checks for expired grace periods and enforces exhausted state.
 */

import type { Logger } from "@proliferate/logger";
import type { Job } from "@proliferate/queue";
import type { BillingGraceJob } from "@proliferate/queue";
import { billing, orgs } from "@proliferate/services";

export async function processGraceJob(_job: Job<BillingGraceJob>, logger: Logger): Promise<void> {
	const graceLog = logger.child({ op: "grace" });

	try {
		const expiredOrgs = await orgs.listGraceExpiredOrgs();
		if (!expiredOrgs.length) return;

		for (const org of expiredOrgs) {
			try {
				// Overage auto-top-up: try to buy credits before enforcing exhausted
				const topup = await billing.attemptAutoTopUp(org.id, 0);
				if (topup.success) {
					graceLog.info(
						{ orgId: org.id, creditsAdded: topup.creditsAdded },
						"Auto-top-up succeeded; skipping grace enforcement",
					);
					continue;
				}

				await orgs.expireGraceForOrg(org.id);
				await billing.enforceCreditsExhausted(org.id);
				graceLog.info({ orgId: org.id }, "Grace expired -> exhausted");
			} catch (err) {
				graceLog.error({ err, orgId: org.id }, "Failed to expire grace for org");
			}
		}
	} catch (err) {
		graceLog.error({ err }, "Error checking grace expirations");
		throw err;
	}
}
