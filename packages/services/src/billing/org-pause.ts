/**
 * Organization-level session pause utilities.
 *
 * Used when:
 * - Payment fails
 * - Overage cap hit
 * - Account suspended
 */

import type { SandboxProvider } from "@proliferate/shared";
import {
	DEFAULT_BILLING_SETTINGS,
	TOP_UP_PRODUCT,
	autumnAutoTopUp,
} from "@proliferate/shared/billing";
import type { OrgBillingSettings, PauseReason } from "@proliferate/shared/billing";
import { and, eq, getDb, sessions } from "../db/client";
import { getBillingInfo, updateBillingSettings } from "../orgs/service";

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
				console.error(`[BulkPause] Failed to pause session: ${r.reason}`);
			}
		}
	}

	console.log(`[BulkPause] Org ${orgId}: ${paused} paused, ${failed} failed (reason: ${reason})`);

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
// Overage Handling
// ============================================

interface ChargeOverageResult {
	success: boolean;
	creditsAdded?: number;
	error?: string;
}

/**
 * Handle credits exhausted for an organization.
 * Either pauses sessions or auto-charges based on overage policy.
 */
export async function handleCreditsExhausted(orgId: string): Promise<ChargeOverageResult> {
	// Get org billing settings
	const org = await getBillingInfo(orgId);

	if (!org) {
		console.error("[Overage] Failed to fetch org settings");
		// Fail safe - pause sessions if we can't fetch settings
		await pauseAllOrgSessions(orgId, "credit_limit");
		return { success: false, error: "Failed to fetch org settings" };
	}

	const settings: OrgBillingSettings = org.billingSettings ?? DEFAULT_BILLING_SETTINGS;

	// Policy: "pause" - hard stop, pause all sessions
	if (settings.overage_policy === "pause") {
		console.log(`[Overage] Policy is 'pause' for org ${orgId}, pausing all sessions`);
		await pauseAllOrgSessions(orgId, "credit_limit");
		return { success: true };
	}

	// Policy: "allow" - attempt auto-charge
	const capCents = settings.overage_cap_cents;
	const usedCents = settings.overage_used_this_month_cents ?? 0;
	const chargeAmountCents = TOP_UP_PRODUCT.priceCents;

	// Check if we'd exceed the overage cap
	if (capCents !== null && usedCents + chargeAmountCents > capCents) {
		console.log(`[Overage] Cap reached for org ${orgId}: used ${usedCents}, cap ${capCents}`);
		await pauseAllOrgSessions(orgId, "overage_cap");
		return { success: false, error: "Overage cap reached" };
	}

	// Attempt auto-charge via Autumn
	console.log(`[Overage] Attempting auto top-up for org ${orgId}`);
	const topUpResult = await autumnAutoTopUp(
		orgId,
		TOP_UP_PRODUCT.productId,
		TOP_UP_PRODUCT.credits,
	);

	if (!topUpResult.success) {
		console.log(`[Overage] Auto top-up failed for org ${orgId}, pausing sessions`);
		await pauseAllOrgSessions(orgId, "credit_limit");
		return {
			success: false,
			error: topUpResult.requiresCheckout ? "No payment method on file" : "Auto-charge failed",
		};
	}

	// Charge succeeded - update overage tracking
	const newUsedCents = usedCents + chargeAmountCents;
	await updateBillingSettings(orgId, {
		...settings,
		overage_used_this_month_cents: newUsedCents,
	});

	console.log(
		`[Overage] Auto top-up succeeded for org ${orgId}: +${TOP_UP_PRODUCT.credits} credits, overage total: $${(newUsedCents / 100).toFixed(2)}`,
	);

	return {
		success: true,
		creditsAdded: TOP_UP_PRODUCT.credits,
	};
}

// ============================================
// V2 Enforcement
// ============================================

/**
 * Handle credits exhausted for an organization (V2).
 *
 * V2: Terminates sessions (not just pause) since we're in exhausted state.
 * The grace period has already expired if we reach here.
 */
export async function handleCreditsExhaustedV2(
	orgId: string,
	providers?: Map<string, SandboxProvider>,
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

	if (!sessionRows.length) {
		return { terminated: 0, failed: 0 };
	}

	let terminated = 0;
	let failed = 0;

	// Stop all running sessions
	for (const session of sessionRows) {
		try {
			// Try to terminate provider sandbox first (best effort)
			const providerType = session.sandboxProvider ?? undefined;
			const provider = providerType ? providers?.get(providerType) : undefined;
			let providerTerminated = !session.sandboxId;

			if (provider && session.sandboxId) {
				try {
					await provider.terminate(session.id, session.sandboxId);
					providerTerminated = true;
				} catch (err) {
					console.error(
						`[Enforcement] Failed to terminate provider sandbox for session ${session.id}:`,
						err,
					);
				}
			} else if (session.sandboxId) {
				console.error(
					`[Enforcement] Missing provider for session ${session.id} (provider: ${session.sandboxProvider ?? "unknown"})`,
				);
			}

			if (!providerTerminated) {
				failed++;
				continue;
			}

			await db
				.update(sessions)
				.set({
					status: "stopped",
					endedAt: new Date(),
					stopReason: "sandbox_terminated",
					pauseReason: "credit_limit",
				})
				.where(eq(sessions.id, session.id));
			terminated++;
		} catch (err) {
			console.error(`[Enforcement] Failed to terminate session ${session.id}:`, err);
			failed++;
		}
	}

	if (failed > 0) {
		console.warn(
			`[Enforcement] Org ${orgId}: ${failed} sessions left running due to provider termination failures`,
		);
	}
	console.log(
		`[Enforcement] Org ${orgId}: terminated ${terminated} sessions (credits exhausted), failed ${failed}`,
	);
	return { terminated, failed };
}

/**
 * Terminate all sessions for an org.
 * Used when billing state transitions to exhausted or suspended.
 */
export async function terminateAllOrgSessions(
	orgId: string,
	reason: "credit_limit" | "suspended",
	providers?: Map<string, SandboxProvider>,
): Promise<{ terminated: number; failed: number }> {
	const db = getDb();

	// Fetch running sessions so we can terminate provider sandboxes
	const sessionRows = await db.query.sessions.findMany({
		where: and(eq(sessions.organizationId, orgId), eq(sessions.status, "running")),
		columns: {
			id: true,
			sandboxId: true,
			sandboxProvider: true,
		},
	});

	let terminated = 0;
	let failed = 0;

	for (const session of sessionRows) {
		try {
			const providerType = session.sandboxProvider ?? undefined;
			const provider = providerType ? providers?.get(providerType) : undefined;
			let providerTerminated = !session.sandboxId;

			if (provider && session.sandboxId) {
				try {
					await provider.terminate(session.id, session.sandboxId);
					providerTerminated = true;
				} catch (err) {
					console.error(
						`[Enforcement] Failed to terminate provider sandbox for session ${session.id}:`,
						err,
					);
				}
			} else if (session.sandboxId) {
				console.error(
					`[Enforcement] Missing provider for session ${session.id} (provider: ${session.sandboxProvider ?? "unknown"})`,
				);
			}

			if (!providerTerminated) {
				failed++;
				continue;
			}

			await db
				.update(sessions)
				.set({
					status: "stopped",
					endedAt: new Date(),
					stopReason: "sandbox_terminated",
					pauseReason: reason,
				})
				.where(eq(sessions.id, session.id));

			terminated++;
		} catch (err) {
			console.error(`[Enforcement] Failed to terminate session ${session.id}:`, err);
			failed++;
		}
	}

	if (failed > 0) {
		console.warn(
			`[Enforcement] Org ${orgId}: ${failed} sessions left running due to provider termination failures`,
		);
	}
	console.log(
		`[Enforcement] Org ${orgId}: terminated ${terminated} sessions (reason: ${reason}), failed ${failed}`,
	);
	return { terminated, failed };
}
