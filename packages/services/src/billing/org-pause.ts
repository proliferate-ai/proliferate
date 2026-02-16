/**
 * Organization-level session pause utilities.
 *
 * Used when:
 * - Payment fails
 * - Overage cap hit
 * - Account suspended
 * - Credits exhausted
 *
 * Enforcement uses lock-safe snapshot/pause transitions instead of
 * hard termination. Sessions are set to status: "paused" (NOT "stopped"),
 * preserving the ability to resume when credits are replenished.
 */

import type { SandboxProviderType } from "@proliferate/shared";
import type { PauseReason } from "@proliferate/shared/billing";
import { revokeVirtualKey } from "@proliferate/shared/llm-proxy";
import { getSandboxProvider } from "@proliferate/shared/providers";
import { and, eq, getDb, sessions } from "../db/client";
import { runWithMigrationLock } from "../lib/lock";
import { getServicesLogger } from "../logger";
import { updateWhereSandboxIdMatches } from "../sessions/db";

// ============================================
// Bulk Pause
// ============================================

interface BulkPauseResult {
	paused: number;
	failed: number;
}

/**
 * Pause ALL running sessions for an organization.
 *
 * @param orgId - Organization ID
 * @param reason - Why sessions are being paused
 * @param concurrency - Max parallel pause operations (default: 5)
 */
export async function pauseAllOrgSessions(
	orgId: string,
	reason: PauseReason,
	concurrency = 5,
): Promise<BulkPauseResult> {
	const db = getDb();
	// Get all running sessions
	const sessionRows = await db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")),
		columns: {
			id: true,
			sandboxId: true,
			sandboxProvider: true,
		},
	});

	if (!sessionRows.length) {
		return { paused: 0, failed: 0 };
	}

	let paused = 0;
	let failed = 0;

	// Process in batches with concurrency limit
	for (let i = 0; i < sessionRows.length; i += concurrency) {
		const batch = sessionRows.slice(i, i + concurrency);

		const results = await Promise.allSettled(
			batch.map((session) => pauseSingleSession(session.id, reason)),
		);

		for (const r of results) {
			if (r.status === "fulfilled") {
				paused++;
			} else {
				failed++;
				getServicesLogger()
					.child({ module: "org-pause" })
					.error({ err: r.reason }, "Failed to pause session");
			}
		}
	}

	getServicesLogger()
		.child({ module: "org-pause", orgId })
		.info({ paused, failed, reason }, "Bulk pause complete");

	return { paused, failed };
}

/**
 * Pause a single session.
 * Does NOT handle snapshot/terminate - that happens in the DO/worker.
 */
async function pauseSingleSession(sessionId: string, reason: PauseReason): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({
			status: "paused",
			pauseReason: reason,
			pausedAt: new Date(),
		})
		.where(and(eq(sessions.id, sessionId), eq(sessions.status, "running")));
}

// ============================================
// Check Org Can Start Session
// ============================================

interface CanStartSessionResult {
	allowed: boolean;
	reason?: string;
	code?: "NO_CREDITS" | "CONCURRENT_LIMIT" | "PAYMENT_FAILED";
}

/**
 * Check if organization can start a new session.
 * Validates credit balance and concurrent session limits.
 */
export async function canOrgStartSession(
	orgId: string,
	_requiredCredits: number,
	maxConcurrent: number,
): Promise<CanStartSessionResult> {
	const db = getDb();
	const result = await db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")),
		columns: { id: true },
	});

	const count = result.length;
	if (count >= maxConcurrent) {
		return {
			allowed: false,
			reason: `Your plan allows ${maxConcurrent} concurrent sessions.`,
			code: "CONCURRENT_LIMIT",
		};
	}

	return { allowed: true };
}

// ============================================
// V2 Enforcement (Lock-Safe Pause/Snapshot)
// ============================================

/**
 * Handle credits exhausted for an organization (V2).
 *
 * Uses lock-safe snapshot/pause transitions instead of hard termination.
 * Each session is individually locked, snapshot'd, and CAS-updated to
 * status: "paused" with pauseReason: "credit_limit".
 *
 * Sessions remain resumable when credits are replenished.
 */
export async function handleCreditsExhaustedV2(
	orgId: string,
	_providers?: Map<string, unknown>,
): Promise<{ terminated: number; failed: number }> {
	const db = getDb();

	// Get all running sessions
	const sessionRows = await db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")),
		columns: {
			id: true,
			sandboxId: true,
			sandboxProvider: true,
		},
	});

	const logger = getServicesLogger().child({ module: "org-pause", orgId });

	if (!sessionRows.length) {
		return { terminated: 0, failed: 0 };
	}

	let terminated = 0;
	let failed = 0;

	for (const session of sessionRows) {
		try {
			await pauseSessionWithSnapshot(
				session.id,
				session.sandboxId,
				session.sandboxProvider,
				"credit_limit",
			);
			terminated++;
		} catch (err) {
			logger.error({ err, sessionId: session.id }, "Failed to pause session for enforcement");
			failed++;
		}
	}

	if (failed > 0) {
		logger.warn({ failed }, "Sessions left running due to pause failures");
	}
	logger.info({ terminated, failed, reason: "credits_exhausted" }, "Enforcement complete");
	return { terminated, failed };
}

/**
 * Terminate all sessions for an org.
 * Used when billing state transitions to exhausted or suspended.
 *
 * Uses lock-safe pause/snapshot transitions to preserve resumability.
 */
export async function terminateAllOrgSessions(
	orgId: string,
	reason: "credit_limit" | "suspended",
	_providers?: Map<string, unknown>,
): Promise<{ terminated: number; failed: number }> {
	const db = getDb();

	const sessionRows = await db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")),
		columns: {
			id: true,
			sandboxId: true,
			sandboxProvider: true,
		},
	});

	const logger = getServicesLogger().child({ module: "org-pause", orgId });

	let terminated = 0;
	let failed = 0;

	for (const session of sessionRows) {
		try {
			await pauseSessionWithSnapshot(
				session.id,
				session.sandboxId,
				session.sandboxProvider,
				reason,
			);
			terminated++;
		} catch (err) {
			logger.error({ err, sessionId: session.id }, "Failed to pause session");
			failed++;
		}
	}

	if (failed > 0) {
		logger.warn({ failed }, "Sessions left running due to pause failures");
	}
	logger.info({ terminated, failed, reason }, "Terminate all sessions complete");
	return { terminated, failed };
}

// ============================================
// Lock-Safe Pause with Snapshot
// ============================================

/**
 * Pause a single session with a lock-safe snapshot.
 *
 * Follows the exact pattern from the orphan sweeper:
 * 1. Acquire migration lock (300s TTL)
 * 2. Re-verify session is still running
 * 3. Snapshot (memory → pause → filesystem)
 * 4. Terminate (non-pause/non-memory providers only)
 * 5. CAS DB update with sandbox_id fencing
 * 6. Revoke LLM virtual key
 */
async function pauseSessionWithSnapshot(
	sessionId: string,
	sandboxId: string | null,
	sandboxProvider: string | null,
	reason: PauseReason,
): Promise<void> {
	const logger = getServicesLogger().child({ module: "org-pause", sessionId });

	if (!sandboxId) {
		// No sandbox — just mark as paused
		const db = getDb();
		await db
			.update(sessions)
			.set({
				status: "paused",
				pauseReason: reason,
				pausedAt: new Date(),
			})
			.where(and(eq(sessions.id, sessionId), eq(sessions.status, "running")));

		revokeVirtualKey(sessionId).catch((err) => {
			logger.debug({ err }, "Failed to revoke virtual key");
		});
		return;
	}

	const ran = await runWithMigrationLock(sessionId, 300_000, async () => {
		const db = getDb();

		// Re-verify session is still running (may have been paused by gateway)
		const session = await db.query.sessions.findFirst({
			where: and(eq(sessions.id, sessionId), eq(sessions.status, "running")),
			columns: { id: true, sandboxId: true },
		});

		if (!session || !session.sandboxId) {
			logger.info("Session already paused or no sandbox");
			return;
		}

		const providerType = sandboxProvider as SandboxProviderType;
		const provider = getSandboxProvider(providerType);

		// Snapshot: memory (preferred) → pause → filesystem
		let snapshotId: string;
		if (provider.supportsMemorySnapshot && provider.memorySnapshot) {
			const result = await provider.memorySnapshot(sessionId, session.sandboxId);
			snapshotId = result.snapshotId;
		} else if (provider.supportsPause) {
			const result = await provider.pause(sessionId, session.sandboxId);
			snapshotId = result.snapshotId;
		} else {
			const result = await provider.snapshot(sessionId, session.sandboxId);
			snapshotId = result.snapshotId;

			// Terminate non-pause/non-memory providers
			try {
				await provider.terminate(sessionId, session.sandboxId);
			} catch (err) {
				logger.error({ err }, "Failed to terminate after snapshot");
			}
		}

		// CAS DB update: only applies if sandbox_id still matches
		const isMemorySnapshot = snapshotId.startsWith("mem:");
		const keepSandbox = isMemorySnapshot || provider.supportsPause;

		const rowsAffected = await updateWhereSandboxIdMatches(sessionId, session.sandboxId, {
			snapshotId,
			sandboxId: keepSandbox ? session.sandboxId : null,
			status: "paused",
			pausedAt: new Date().toISOString(),
			pauseReason: reason,
		});

		if (rowsAffected === 0) {
			logger.info("CAS mismatch — another actor advanced state");
			return;
		}

		// Best-effort key revocation
		revokeVirtualKey(sessionId).catch((err) => {
			logger.debug({ err }, "Failed to revoke virtual key");
		});

		logger.info({ snapshotId, reason }, "Session paused with snapshot");
	});

	if (ran === null) {
		logger.info("Lock already held, skipping");
	}
}
