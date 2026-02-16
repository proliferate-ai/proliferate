/**
 * Orphan Sweeper
 *
 * Periodically scans active hubs for sessions that have lost their
 * runtime lease (sandbox died or became unreachable). Transitions
 * orphaned sessions to a safe paused/stopped state via the lock-safe
 * idle snapshot path, preventing compute leaks.
 *
 * Runs every 15 minutes within the gateway process.
 */

import type { Logger } from "@proliferate/logger";
import type { HubManager } from "../hub";
import { hasRuntimeLease } from "../lib/session-leases";

/** Sweep interval: 15 minutes. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

async function sweep(hubManager: HubManager, logger: Logger): Promise<void> {
	const sessionIds = hubManager.getActiveSessionIds();
	if (sessionIds.length === 0) {
		return;
	}

	logger.debug({ activeHubs: sessionIds.length }, "orphan_sweep.start");
	let orphanCount = 0;

	for (const sessionId of sessionIds) {
		const hub = hubManager.get(sessionId);
		if (!hub) {
			continue;
		}

		try {
			const hasLease = await hasRuntimeLease(sessionId);
			if (hasLease) {
				continue;
			}

			// No runtime lease — sandbox may have died.
			if (!hub.shouldIdleSnapshot()) {
				// Active clients or tool calls — skip, not truly orphaned.
				logger.debug({ sessionId }, "orphan_sweep.skip_active");
				continue;
			}

			logger.info({ sessionId }, "orphan_sweep.found_orphan");
			orphanCount++;

			await hub.runIdleSnapshot();
			logger.info({ sessionId }, "orphan_sweep.orphan_cleaned");
		} catch (err) {
			logger.error({ err, sessionId }, "orphan_sweep.cleanup_failed");
		}
	}

	logger.info({ scanned: sessionIds.length, orphans: orphanCount }, "orphan_sweep.complete");
}

/**
 * Start the orphan sweeper on a 15-minute interval.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startOrphanSweeper(hubManager: HubManager, logger: Logger): void {
	if (sweepTimer) {
		return;
	}

	const log = logger.child({ module: "orphan-sweeper" });
	log.info({ intervalMs: SWEEP_INTERVAL_MS }, "Orphan sweeper started");

	sweepTimer = setInterval(() => {
		sweep(hubManager, log).catch((err) => {
			log.error({ err }, "Orphan sweep failed");
		});
	}, SWEEP_INTERVAL_MS);
}

/**
 * Stop the orphan sweeper. Used for graceful shutdown.
 */
export function stopOrphanSweeper(): void {
	if (sweepTimer) {
		clearInterval(sweepTimer);
		sweepTimer = null;
	}
}
