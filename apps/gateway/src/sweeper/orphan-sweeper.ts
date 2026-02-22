/**
 * Orphan Sweeper
 *
 * Periodically queries the DB for sessions with status = 'running', then
 * checks each for a valid runtime lease. Sessions without a lease are
 * considered orphaned (sandbox died or gateway crashed) and are
 * safely paused via snapshot + terminate + CAS DB update.
 *
 * Unlike the previous hub-only approach, this DB-first sweep correctly
 * discovers orphans even after a full gateway restart (when the in-memory
 * hub map is empty).
 *
 * Runs every 15 minutes within the gateway process.
 */

import type { Logger } from "@proliferate/logger";
import { notifications, sessions } from "@proliferate/services";
import type { SandboxProviderType } from "@proliferate/shared";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { cancelSessionExpiry } from "../expiry/expiry-queue";
import type { HubManager } from "../hub";
import { prepareForSnapshot } from "../hub/snapshot-scrub";
import type { GatewayEnv } from "../lib/env";
import { runWithMigrationLock } from "../lib/lock";
import { hasRuntimeLease } from "../lib/session-leases";

/** Sweep interval: 15 minutes. */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

async function sweep(hubManager: HubManager, env: GatewayEnv, logger: Logger): Promise<void> {
	const runningIds = await sessions.listRunningSessionIds();
	if (runningIds.length === 0) {
		logger.info({ scanned: 0, orphans: 0 }, "orphan_sweep.complete");
		return;
	}

	logger.debug({ count: runningIds.length }, "orphan_sweep.start");
	let orphanCount = 0;

	for (const sessionId of runningIds) {
		try {
			const leaseActive = await hasRuntimeLease(sessionId);
			if (leaseActive) {
				continue;
			}

			// No runtime lease — possible orphan.
			// If we have a local hub, delegate to its idle snapshot logic.
			const hub = hubManager.get(sessionId);
			if (hub) {
				if (!hub.shouldIdleSnapshot()) {
					logger.debug({ sessionId }, "orphan_sweep.skip_active");
					continue;
				}

				orphanCount++;
				logger.info({ sessionId }, "orphan_sweep.found_orphan");
				await hub.runIdleSnapshot();
				logger.info({ sessionId }, "orphan_sweep.orphan_cleaned");
				continue;
			}

			// No local hub — truly orphaned session. Clean up directly.
			orphanCount++;
			logger.info({ sessionId }, "orphan_sweep.found_orphan_no_hub");
			await cleanupOrphanedSession(sessionId, env, logger);
		} catch (err) {
			logger.error({ err, sessionId }, "orphan_sweep.cleanup_failed");
		}
	}

	logger.info({ scanned: runningIds.length, orphans: orphanCount }, "orphan_sweep.complete");
}

/**
 * Clean up a truly orphaned session (no local hub).
 * Acquires the migration lock, re-validates, snapshots, terminates,
 * and CAS-updates the DB to "paused".
 */
async function cleanupOrphanedSession(
	sessionId: string,
	env: GatewayEnv,
	logger: Logger,
): Promise<void> {
	const ran = await runWithMigrationLock(sessionId, 300_000, async () => {
		// Re-check lease inside lock (another gateway may have picked it up)
		const leaseActive = await hasRuntimeLease(sessionId);
		if (leaseActive) {
			logger.info({ sessionId }, "orphan_sweep.abort_lease_reappeared");
			return;
		}

		// Fetch session from DB
		const session = await sessions.findByIdInternal(sessionId);
		if (!session || session.status !== "running") {
			logger.info({ sessionId, status: session?.status }, "orphan_sweep.abort_status_changed");
			return;
		}

		const sandboxId = session.sandboxId;
		if (!sandboxId) {
			// No sandbox — just mark as paused
			await sessions.update(sessionId, {
				status: "paused",
				pauseReason: "orphaned",
				latestTask: null,
			});
			// Enqueue session completion notifications (best-effort)
			try {
				await notifications.enqueueSessionCompletionNotification(session.organizationId, sessionId);
			} catch (err) {
				logger.error({ err, sessionId }, "orphan_sweep.notification_failed");
			}
			logger.info({ sessionId }, "orphan_sweep.paused_no_sandbox");
			return;
		}

		const providerType = session.sandboxProvider as SandboxProviderType;
		const provider = getSandboxProvider(providerType);
		const finalizeSnapshotPrep = await prepareForSnapshot({
			provider,
			sandboxId,
			configurationId: session.configurationId,
			logger,
			logContext: "orphan_sweep",
			failureMode: "log",
			reapplyAfterCapture: false,
		});

		// Snapshot: memory (preferred) → pause → filesystem
		let snapshotId: string | undefined;
		let keepSandbox = false;
		try {
			try {
				if (provider.supportsMemorySnapshot && provider.memorySnapshot) {
					const result = await provider.memorySnapshot(sessionId, sandboxId);
					snapshotId = result.snapshotId;
					keepSandbox = true;
				} else if (provider.supportsPause) {
					const result = await provider.pause(sessionId, sandboxId);
					snapshotId = result.snapshotId;
					keepSandbox = true;
				} else {
					const result = await provider.snapshot(sessionId, sandboxId);
					snapshotId = result.snapshotId;

					try {
						await provider.terminate(sessionId, sandboxId);
					} catch (err) {
						logger.error({ err, sessionId }, "orphan_sweep.terminate_failed");
					}
				}
			} finally {
				await finalizeSnapshotPrep();
			}
		} catch (err) {
			if (!isSandboxAlreadyFinishedError(err)) {
				throw err;
			}
			logger.info(
				{
					sessionId,
					sandboxId,
					error: err instanceof Error ? err.message : String(err),
				},
				"orphan_sweep.sandbox_already_finished",
			);
			keepSandbox = false;
		}

		// CAS DB update (keep sandbox alive for memory snapshot / pause providers)
		const rowsAffected = await sessions.updateWhereSandboxIdMatches(sessionId, sandboxId, {
			...(snapshotId ? { snapshotId } : {}),
			sandboxId: keepSandbox ? sandboxId : null,
			status: "paused",
			pausedAt: new Date().toISOString(),
			pauseReason: "orphaned",
			latestTask: null,
		});

		if (rowsAffected === 0) {
			logger.info({ sessionId }, "orphan_sweep.cas_mismatch");
			return;
		}

		// Cancel stale expiry job
		try {
			await cancelSessionExpiry(env, sessionId);
		} catch (err) {
			logger.error({ err, sessionId }, "orphan_sweep.cancel_expiry_failed");
		}

		// Enqueue session completion notifications (best-effort)
		try {
			await notifications.enqueueSessionCompletionNotification(session.organizationId, sessionId);
		} catch (err) {
			logger.error({ err, sessionId }, "orphan_sweep.notification_failed");
		}

		logger.info({ sessionId, snapshotId }, "orphan_sweep.session_paused");
	});

	if (ran === null) {
		logger.info({ sessionId }, "orphan_sweep.lock_held");
	}
}

function isSandboxAlreadyFinishedError(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	return (
		err.message.includes("FAILED_PRECONDITION") &&
		err.message.includes("Sandbox has already finished")
	);
}

/**
 * Start the orphan sweeper on a 15-minute interval.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startOrphanSweeper(hubManager: HubManager, env: GatewayEnv, logger: Logger): void {
	if (sweepTimer) {
		return;
	}

	const log = logger.child({ module: "orphan-sweeper" });
	log.info(
		{
			intervalMs: SWEEP_INTERVAL_MS,
			firstRunAt: new Date(Date.now() + SWEEP_INTERVAL_MS).toISOString(),
		},
		"Orphan sweeper started",
	);

	sweepTimer = setInterval(() => {
		sweep(hubManager, env, log).catch((err) => {
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
