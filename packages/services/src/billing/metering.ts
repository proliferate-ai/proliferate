/**
 * Compute metering for sandbox sessions.
 *
 * Key Invariant: A specific [from, to) interval is billable exactly once.
 * The idempotency key is derived from interval boundaries, not wall clock time.
 */

import type { SandboxProvider } from "@proliferate/shared";
import {
	BILLING_REDIS_KEYS,
	METERING_CONFIG,
	type PauseReason,
	acquireLock,
	calculateComputeCredits,
	releaseLock,
	renewLock,
} from "@proliferate/shared/billing";
import type IORedis from "ioredis";
import { eq, getDb, sessions } from "../db/client";
import { handleCreditsExhaustedV2 } from "./org-pause";
import { deductShadowBalance } from "./shadow-balance";
import { tryActivatePlanAfterTrial } from "./trial-activation";

// ============================================
// Types
// ============================================

interface SessionForMetering {
	id: string;
	organizationId: string;
	sandboxId: string | null;
	sandboxProvider: string | null;
	meteredThroughAt: Date | null;
	startedAt: Date;
	status: string;
	lastSeenAliveAt: Date | null;
	aliveCheckFailures: number | null;
}

// ============================================
// Main Metering Function
// ============================================

/**
 * Run a single metering cycle.
 * Should be called every 30 seconds by a worker.
 *
 * @param redis - Redis client for distributed locking
 * @param providers - Map of provider type to provider instance
 */
export async function runMeteringCycle(
	redis: IORedis,
	providers: Map<string, SandboxProvider>,
): Promise<void> {
	const lockToken = crypto.randomUUID();

	// Acquire lock
	const acquired = await acquireLock(
		redis,
		BILLING_REDIS_KEYS.meteringLock,
		lockToken,
		METERING_CONFIG.lockTtlMs,
	);

	if (!acquired) {
		console.log("[Metering] Another worker has the lock, skipping");
		return;
	}

	// Set up renewal interval with error handling
	let renewalFailed = false;
	const renewInterval = setInterval(async () => {
		try {
			await renewLock(redis, BILLING_REDIS_KEYS.meteringLock, lockToken, METERING_CONFIG.lockTtlMs);
		} catch (err) {
			console.error("[Metering] Lock renewal failed:", err);
			renewalFailed = true;
		}
	}, METERING_CONFIG.lockRenewIntervalMs);

	try {
		// Helper to check if we should abort due to lock renewal failure
		const checkLockValid = () => {
			if (renewalFailed) {
				throw new Error("Lock renewal failed - aborting metering cycle to prevent conflicts");
			}
		};
		const nowMs = Date.now();
		const db = getDb();

		// Get all running sessions
		const sessionsToMeter = (await db.query.sessions.findMany({
			where: eq(sessions.status, "running"),
			columns: {
				id: true,
				organizationId: true,
				sandboxId: true,
				sandboxProvider: true,
				meteredThroughAt: true,
				startedAt: true,
				status: true,
				lastSeenAliveAt: true,
				aliveCheckFailures: true,
			},
		})) as SessionForMetering[];

		if (!sessionsToMeter.length) {
			console.log("[Metering] No running sessions");
			return;
		}

		console.log(`[Metering] Processing ${sessionsToMeter.length} running sessions`);

		// Check sandbox liveness
		const aliveStatus = await checkSandboxesWithGrace(sessionsToMeter, providers);

		// Check lock validity before processing sessions
		checkLockValid();

		// Process each session
		for (const session of sessionsToMeter) {
			// Check lock validity before each session to fail fast if lock is lost
			checkLockValid();

			try {
				const isAlive = aliveStatus.get(session.sandboxId ?? "");

				if (!isAlive && session.sandboxId) {
					// Sandbox confirmed dead - bill final interval and mark stopped
					await billFinalInterval(session, nowMs, providers);
				} else {
					// Sandbox alive - bill regular interval
					await billRegularInterval(session, nowMs, providers);
				}
			} catch (err) {
				console.error(`[Metering] Error processing session ${session.id}:`, err);
			}
		}
	} finally {
		clearInterval(renewInterval);
		await releaseLock(redis, BILLING_REDIS_KEYS.meteringLock, lockToken);
	}
}

// ============================================
// Sandbox Liveness Checking
// ============================================

/**
 * Check sandbox liveness with grace period.
 * Require N consecutive failures before declaring dead.
 */
async function checkSandboxesWithGrace(
	sessionsToMeter: SessionForMetering[],
	providers: Map<string, SandboxProvider>,
): Promise<Map<string, boolean>> {
	const result = new Map<string, boolean>();
	const db = getDb();

	// Group sessions by provider
	const sessionsByProvider = new Map<string, SessionForMetering[]>();
	for (const session of sessionsToMeter) {
		if (!session.sandboxProvider || !session.sandboxId) {
			// No sandbox - consider it dead
			result.set(session.sandboxId ?? "", false);
			continue;
		}

		const existing = sessionsByProvider.get(session.sandboxProvider) ?? [];
		existing.push(session);
		sessionsByProvider.set(session.sandboxProvider, existing);
	}

	// Check each provider
	for (const [providerType, providerSessions] of sessionsByProvider) {
		const provider = providers.get(providerType);
		if (!provider?.checkSandboxes) {
			// Provider doesn't support checking - assume alive
			for (const s of providerSessions) {
				result.set(s.sandboxId!, true);
			}
			continue;
		}

		const sandboxIds = providerSessions.map((s) => s.sandboxId!).filter(Boolean);

		// Batch check
		const aliveSandboxIds = new Set(await provider.checkSandboxes(sandboxIds));

		// Process results with grace period
		for (const session of providerSessions) {
			const isAliveNow = aliveSandboxIds.has(session.sandboxId!);

			if (isAliveNow) {
				// Reset failure count
				await db
					.update(sessions)
					.set({
						lastSeenAliveAt: new Date(),
						aliveCheckFailures: 0,
					})
					.where(eq(sessions.id, session.id));

				result.set(session.sandboxId!, true);
			} else {
				// Increment failure count
				const newFailures = (session.aliveCheckFailures ?? 0) + 1;

				await db
					.update(sessions)
					.set({ aliveCheckFailures: newFailures })
					.where(eq(sessions.id, session.id));

				// Only declare dead after N consecutive failures
				const isDead = newFailures >= METERING_CONFIG.graceFailures;
				result.set(session.sandboxId!, !isDead);

				if (!isDead) {
					console.log(
						`[Metering] Session ${session.id} check failed (${newFailures}/${METERING_CONFIG.graceFailures})`,
					);
				}
			}
		}
	}

	return result;
}

// ============================================
// Billing Functions
// ============================================

/**
 * Bill a regular interval for an active session.
 */
async function billRegularInterval(
	session: SessionForMetering,
	nowMs: number,
	providers: Map<string, SandboxProvider>,
): Promise<void> {
	const meteredThroughMs = session.meteredThroughAt
		? session.meteredThroughAt.getTime()
		: session.startedAt.getTime();

	const elapsedMs = nowMs - meteredThroughMs;
	const billableSeconds = Math.floor(elapsedMs / 1000);

	if (billableSeconds < METERING_CONFIG.minBillableSeconds) {
		// Skip tiny intervals
		return;
	}

	// Calculate the boundary we're billing THROUGH (not `now`)
	const billedThroughMs = meteredThroughMs + billableSeconds * 1000;

	// Deterministic idempotency key based on interval boundaries
	const idempotencyKey = `compute:${session.id}:${meteredThroughMs}:${billedThroughMs}`;

	await billComputeInterval(session, billableSeconds, billedThroughMs, idempotencyKey, providers);
}

/**
 * Bill final interval when session stops (sandbox dead).
 *
 * IMPORTANT: Bills through last_seen_alive_at, NOT now.
 * This prevents overbilling for time when sandbox was already dead.
 */
async function billFinalInterval(
	session: SessionForMetering,
	_nowMs: number,
	providers: Map<string, SandboxProvider>,
): Promise<void> {
	const meteredThroughMs = session.meteredThroughAt
		? session.meteredThroughAt.getTime()
		: session.startedAt.getTime();

	// Bill through last known alive time, not detection time
	// Add one poll interval as conservative upper bound for confirmed-alive sessions
	// If never seen alive, use a smaller 5s grace period to avoid overcharging for immediate failures
	const NEVER_SEEN_GRACE_MS = 5000;
	const lastAliveMs = session.lastSeenAliveAt
		? session.lastSeenAliveAt.getTime() + METERING_CONFIG.pollIntervalMs
		: session.startedAt.getTime() + NEVER_SEEN_GRACE_MS;

	const billThroughMs = Math.max(meteredThroughMs, lastAliveMs);
	const remainingSeconds = Math.ceil((billThroughMs - meteredThroughMs) / 1000);

	if (remainingSeconds > 0) {
		const idempotencyKey = `compute:${session.id}:${meteredThroughMs}:final`;
		await billComputeInterval(session, remainingSeconds, billThroughMs, idempotencyKey, providers);
	}

	// Mark session as stopped
	const db = getDb();
	await db
		.update(sessions)
		.set({
			status: "stopped",
			endedAt: new Date(),
			stopReason: "sandbox_terminated",
		})
		.where(eq(sessions.id, session.id));

	console.log(`[Metering] Session ${session.id} marked as stopped (sandbox dead)`);
}

/**
 * Bill a compute interval using shadow balance (V2).
 *
 * Uses atomic shadow balance deduction instead of direct Autumn calls.
 * The outbox worker will sync with Autumn asynchronously.
 */
async function billComputeInterval(
	session: SessionForMetering,
	billableSeconds: number,
	billedThroughMs: number,
	idempotencyKey: string,
	providers: Map<string, SandboxProvider>,
): Promise<void> {
	const db = getDb();
	const credits = calculateComputeCredits(billableSeconds);
	const meteredThroughMs = session.meteredThroughAt
		? session.meteredThroughAt.getTime()
		: session.startedAt.getTime();

	// V2: Use shadow balance for atomic deduction + billing event insert
	const result = await deductShadowBalance({
		organizationId: session.organizationId,
		quantity: billableSeconds,
		credits,
		eventType: "compute",
		idempotencyKey,
		sessionIds: [session.id],
		metadata: {
			from_ms: meteredThroughMs,
			to_ms: billedThroughMs,
		},
	});

	// Idempotent - already processed
	if (!result.success) {
		await db
			.update(sessions)
			.set({ meteredThroughAt: new Date(billedThroughMs) })
			.where(eq(sessions.id, session.id));
		console.log(
			`[Metering] Idempotent skip: ${idempotencyKey} (interval ${meteredThroughMs}-${billedThroughMs}ms, ${billableSeconds}s)`,
		);
		return;
	}

	// Advance metered_through_at
	await db
		.update(sessions)
		.set({ meteredThroughAt: new Date(billedThroughMs) })
		.where(eq(sessions.id, session.id));

	console.log(
		`[Metering] Session ${session.id}: ${billableSeconds}s = ${credits.toFixed(2)} credits (balance: ${result.newBalance.toFixed(2)})`,
	);

	// Handle state transitions
	if (result.shouldTerminateSessions) {
		if (result.previousState === "trial" && result.newState === "exhausted") {
			const activation = await tryActivatePlanAfterTrial(session.organizationId);
			if (activation.activated) {
				console.log(
					`[Metering] Org ${session.organizationId} trial auto-activated; skipping termination`,
				);
				return;
			}
		}
		console.log(
			`[Metering] Org ${session.organizationId} balance exhausted - terminating sessions: ${result.enforcementReason}`,
		);
		await handleCreditsExhaustedV2(session.organizationId, providers);
	} else if (result.shouldBlockNewSessions) {
		console.log(
			`[Metering] Org ${session.organizationId} entering grace period: ${result.enforcementReason}`,
		);
		// Grace period started - new sessions will be blocked but existing ones continue
	}
}

// ============================================
// Billing Finalization (for pause/end)
// ============================================

/**
 * Finalize compute billing for a session that is being paused or stopped.
 * V2: Uses shadow balance for atomic deduction.
 */
export async function finalizeSessionBilling(
	sessionId: string,
	endTimeMs?: number,
): Promise<{ creditsBilled: number; secondsBilled: number }> {
	const nowMs = endTimeMs ?? Date.now();
	const db = getDb();

	// Fetch session with billing fields
	const session = (await db.query.sessions.findFirst({
		where: eq(sessions.id, sessionId),
		columns: {
			id: true,
			organizationId: true,
			meteredThroughAt: true,
			startedAt: true,
			status: true,
		},
	})) as SessionForMetering | null;

	if (!session) {
		console.error(`[BillingFinalize] Session not found: ${sessionId}`);
		return { creditsBilled: 0, secondsBilled: 0 };
	}

	// Only finalize running sessions
	if (session.status !== "running") {
		return { creditsBilled: 0, secondsBilled: 0 };
	}

	const meteredThroughMs = session.meteredThroughAt
		? session.meteredThroughAt.getTime()
		: session.startedAt.getTime();

	const remainingSeconds = Math.ceil((nowMs - meteredThroughMs) / 1000);

	if (remainingSeconds <= 0) {
		return { creditsBilled: 0, secondsBilled: 0 };
	}

	const credits = calculateComputeCredits(remainingSeconds);
	const idempotencyKey = `compute:${session.id}:${meteredThroughMs}:final`;

	// V2: Use shadow balance for atomic deduction
	const result = await deductShadowBalance({
		organizationId: session.organizationId,
		quantity: remainingSeconds,
		credits,
		eventType: "compute",
		idempotencyKey,
		sessionIds: [session.id],
		metadata: {
			from_ms: meteredThroughMs,
			to_ms: nowMs,
			finalized: true,
		},
	});

	// Idempotent - already processed
	if (!result.success) {
		return { creditsBilled: 0, secondsBilled: 0 };
	}

	// Advance metered_through_at
	await db
		.update(sessions)
		.set({ meteredThroughAt: new Date(nowMs) })
		.where(eq(sessions.id, session.id));

	console.log(
		`[BillingFinalize] Session ${session.id}: ${remainingSeconds}s = ${credits.toFixed(2)} credits (balance: ${result.newBalance.toFixed(2)})`,
	);

	return { creditsBilled: credits, secondsBilled: remainingSeconds };
}

// ============================================
// Auto-Pause
// ============================================

/**
 * Auto-pause a session due to billing limits.
 */
export async function autoPauseSession(
	session: { id: string; organizationId: string },
	reason: PauseReason,
): Promise<void> {
	const db = getDb();
	// Update session status
	await db
		.update(sessions)
		.set({
			status: "paused",
			pauseReason: reason,
			pausedAt: new Date(),
		})
		.where(eq(sessions.id, session.id));

	console.log(`[AutoPause] Session ${session.id} paused: ${reason}`);
}
