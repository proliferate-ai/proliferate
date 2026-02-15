/**
 * Action Sweepers
 *
 * Periodically marks stale pending action invocations as expired
 * and cleans up expired action grants.
 */

import type { Logger } from "@proliferate/logger";
import { actions } from "@proliferate/services";

const SWEEP_INTERVAL_MS = 60_000; // Every 60 seconds
const GRANT_CLEANUP_INTERVAL_MS = 3_600_000; // Every hour

let expiryInterval: ReturnType<typeof setInterval> | null = null;
let grantCleanupInterval: ReturnType<typeof setInterval> | null = null;
let sweepLogger: Logger | null = null;

export function startActionExpirySweeper(logger: Logger): void {
	sweepLogger = logger;
	logger.info("Starting action expiry sweeper");

	expiryInterval = setInterval(async () => {
		try {
			const expired = await actions.expireStaleInvocations();
			if (expired > 0) {
				sweepLogger?.info({ expired }, "Expired stale action invocations");
			}
		} catch (err) {
			sweepLogger?.error({ err }, "Action expiry sweep failed");
		}
	}, SWEEP_INTERVAL_MS);
}

export function stopActionExpirySweeper(): void {
	if (expiryInterval) {
		clearInterval(expiryInterval);
		expiryInterval = null;
	}
	sweepLogger?.info("Action expiry sweeper stopped");
}

export function startGrantCleanupSweeper(logger: Logger): void {
	sweepLogger = logger;
	logger.info("Starting grant cleanup sweeper");

	grantCleanupInterval = setInterval(async () => {
		try {
			const deleted = await actions.cleanupExpiredGrants();
			if (deleted > 0) {
				sweepLogger?.info({ deleted }, "Cleaned up expired grants");
			}
		} catch (err) {
			sweepLogger?.error({ err }, "Grant cleanup sweep failed");
		}
	}, GRANT_CLEANUP_INTERVAL_MS);
}

export function stopGrantCleanupSweeper(): void {
	if (grantCleanupInterval) {
		clearInterval(grantCleanupInterval);
		grantCleanupInterval = null;
	}
	sweepLogger?.info("Grant cleanup sweeper stopped");
}
