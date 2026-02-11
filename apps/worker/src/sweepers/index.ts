/**
 * Action Expiry Sweeper
 *
 * Periodically marks stale pending action invocations as expired.
 */

import type { Logger } from "@proliferate/logger";
import { actions } from "@proliferate/services";

const SWEEP_INTERVAL_MS = 60_000; // Every 60 seconds

let interval: ReturnType<typeof setInterval> | null = null;
let sweepLogger: Logger | null = null;

export function startActionExpirySweeper(logger: Logger): void {
	sweepLogger = logger;
	logger.info("Starting action expiry sweeper");

	interval = setInterval(async () => {
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
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
	sweepLogger?.info("Action expiry sweeper stopped");
}
