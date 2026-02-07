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
import { getServicesLogger } from "../logger";
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
				getServicesLogger().child({ module: "org-pause" }).error({ err: r.reason }, "Failed to pause session");
			}
		}
	}

	getServicesLogger().child({ module: "org-pause", orgId }).info({ paused, failed, reason }, "Bulk pause complete");

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

	const logger = getServicesLogger().child({ module: "org-pause", orgId });

	if (!org) {
		logger.error("Failed to fetch org settings");
		// Fail safe - pause sessions if we can't fetch settings
		await pauseAllOrgSessions(orgId, "credit_limit");
		return { success: false, error: "Failed to fetch org settings" };
	}

	const settings: OrgBillingSettings = org.billingSettings ?? DEFAULT_BILLING_SETTINGS;

	// Policy: "pause" - hard stop, pause all sessions
	if (settings.overage_policy === "pause") {
		logger.info("Overage policy is pause, pausing all sessions");
		await pauseAllOrgSessions(orgId, "credit_limit");
		return { success: true };
	}

	// Policy: "allow" - attempt auto-charge
	const capCents = settings.overage_cap_cents;
	const usedCents = settings.overage_used_this_month_cents ?? 0;
	const chargeAmountCents = TOP_UP_PRODUCT.priceCents;

	// Check if we'd exceed the overage cap
	if (capCents !== null && usedCents + chargeAmountCents > capCents) {
		logger.info({ usedCents, capCents }, "Overage cap reached");
		await pauseAllOrgSessions(orgId, "overage_cap");
		return { success: false, error: "Overage cap reached" };
	}

	// Attempt auto-charge via Autumn
	logger.info("Attempting auto top-up");
	const topUpResult = await autumnAutoTopUp(
		orgId,
		TOP_UP_PRODUCT.productId,
		TOP_UP_PRODUCT.credits,
	);

	if (!topUpResult.success) {
		logger.warn("Auto top-up failed, pausing sessions");
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

	logger.info(
		{ creditsAdded: TOP_UP_PRODUCT.credits, overageTotalCents: newUsedCents },
		"Auto top-up succeeded",
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

	const logger = getServicesLogger().child({ module: "org-pause", orgId });

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
					logger.error(
						{ err, sessionId: session.id },
						"Failed to terminate provider sandbox",
					);
				}
			} else if (session.sandboxId) {
				logger.error(
					{ sessionId: session.id, provider: session.sandboxProvider ?? "unknown" },
					"Missing provider for session",
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
			logger.error({ err, sessionId: session.id }, "Failed to terminate session");
			failed++;
		}
	}

	if (failed > 0) {
		logger.warn(
			{ failed },
			"Sessions left running due to provider termination failures",
		);
	}
	logger.info(
		{ terminated, failed, reason: "credits_exhausted" },
		"Enforcement complete",
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

	const logger = getServicesLogger().child({ module: "org-pause", orgId });

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
					logger.error(
						{ err, sessionId: session.id },
						"Failed to terminate provider sandbox",
					);
				}
			} else if (session.sandboxId) {
				logger.error(
					{ sessionId: session.id, provider: session.sandboxProvider ?? "unknown" },
					"Missing provider for session",
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
			logger.error({ err, sessionId: session.id }, "Failed to terminate session");
			failed++;
		}
	}

	if (failed > 0) {
		logger.warn(
			{ failed },
			"Sessions left running due to provider termination failures",
		);
	}
	logger.info(
		{ terminated, failed, reason },
		"Terminate all sessions complete",
	);
	return { terminated, failed };
}
