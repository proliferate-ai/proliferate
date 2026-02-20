/**
 * Auto-top-up service for overage policy execution.
 *
 * When an org has overage_policy = "allow" and balance goes negative,
 * this module auto-charges in increments to keep sessions running.
 *
 * Key invariants:
 * - Auto-top-up happens OUTSIDE the shadow balance FOR UPDATE transaction
 * - Uses pg_advisory_xact_lock to prevent concurrent top-ups per org
 * - Circuit breaker trips on card decline → forces pause behavior
 * - Velocity + rate limits prevent runaway charges
 */

import {
	OVERAGE_INCREMENT_CREDITS,
	OVERAGE_MAX_TOPUPS_PER_CYCLE,
	OVERAGE_MIN_TOPUP_INTERVAL_MS,
	type OverageTopUpResult,
	TOP_UP_PRODUCT,
	autumnAutoTopUp,
	getCurrentCycleMonth,
	parseBillingSettings,
} from "@proliferate/shared/billing";
import { eq, getDb, organization, sql } from "../db/client";
import { getServicesLogger } from "../logger";
import { enforceCreditsExhausted } from "./org-pause";
import { addShadowBalance } from "./shadow-balance";

const emptyResult: OverageTopUpResult = {
	success: false,
	packsCharged: 0,
	creditsAdded: 0,
	chargedCents: 0,
};

/**
 * Attempt an auto-top-up for an org with overage_policy = "allow".
 *
 * Called after deductShadowBalance detects enforcement is needed.
 * Returns success=true if credits were added (caller should skip enforcement).
 */
export async function attemptAutoTopUp(
	orgId: string,
	deficitCredits: number,
): Promise<OverageTopUpResult> {
	const log = getServicesLogger().child({ module: "auto-topup", orgId });
	const db = getDb();

	// 1. Load org overage state
	const [org] = await db
		.select({
			billingSettings: organization.billingSettings,
			autumnCustomerId: organization.autumnCustomerId,
			overageUsedCents: organization.overageUsedCents,
			overageCycleMonth: organization.overageCycleMonth,
			overageTopupCount: organization.overageTopupCount,
			overageLastTopupAt: organization.overageLastTopupAt,
			overageDeclineAt: organization.overageDeclineAt,
		})
		.from(organization)
		.where(eq(organization.id, orgId));

	if (!org) {
		log.error("Org not found");
		return emptyResult;
	}

	const settings = parseBillingSettings(org.billingSettings);

	// 2. Policy check
	if (settings.overage_policy !== "allow") {
		return emptyResult;
	}

	if (!org.autumnCustomerId) {
		log.warn("No Autumn customer ID — cannot auto-top-up");
		return emptyResult;
	}

	// 3. Circuit breaker check
	if (org.overageDeclineAt) {
		log.info("Circuit breaker active — skipping auto-top-up");
		return { ...emptyResult, circuitBreakerTripped: true };
	}

	// Use advisory lock transaction to prevent concurrent top-ups.
	// Enforcement and shadow balance updates happen AFTER the transaction commits.
	let shouldEnforce = false;
	const txResult = await db.transaction(async (tx) => {
		// 4. Acquire advisory lock (per-org, distinct from shadow balance lock)
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orgId} || ':auto_topup'))`);

		// 5. Re-read state under lock (another caller may have topped up)
		const [fresh] = await tx
			.select({
				overageUsedCents: organization.overageUsedCents,
				overageCycleMonth: organization.overageCycleMonth,
				overageTopupCount: organization.overageTopupCount,
				overageLastTopupAt: organization.overageLastTopupAt,
				overageDeclineAt: organization.overageDeclineAt,
				shadowBalance: organization.shadowBalance,
			})
			.from(organization)
			.where(eq(organization.id, orgId));

		if (!fresh) return emptyResult;

		// If balance is now positive (another caller topped up), skip
		if (Number(fresh.shadowBalance ?? 0) > 0) {
			log.debug("Balance already positive after lock — skipping");
			return emptyResult;
		}

		// Circuit breaker may have been set by another caller
		if (fresh.overageDeclineAt) {
			return { ...emptyResult, circuitBreakerTripped: true };
		}

		let overageUsedCents = fresh.overageUsedCents;
		let overageTopupCount = fresh.overageTopupCount;
		let overageCycleMonth = fresh.overageCycleMonth;

		// 6. Lazy monthly reset
		const currentCycle = getCurrentCycleMonth();
		if (overageCycleMonth !== currentCycle) {
			overageUsedCents = 0;
			overageTopupCount = 0;
			overageCycleMonth = currentCycle;
			await tx
				.update(organization)
				.set({
					overageUsedCents: 0,
					overageTopupCount: 0,
					overageCycleMonth: currentCycle,
					overageDeclineAt: null, // Reset circuit breaker on new cycle
				})
				.where(eq(organization.id, orgId));
			log.info({ newCycle: currentCycle }, "Overage cycle reset");
		}

		// 7. Velocity check
		if (overageTopupCount >= OVERAGE_MAX_TOPUPS_PER_CYCLE) {
			log.warn(
				{ count: overageTopupCount, max: OVERAGE_MAX_TOPUPS_PER_CYCLE, alert: true },
				"Velocity limit reached",
			);
			return { ...emptyResult, velocityLimited: true };
		}

		// 8. Rate limit check
		if (fresh.overageLastTopupAt) {
			const msSinceLast = Date.now() - fresh.overageLastTopupAt.getTime();
			if (msSinceLast < OVERAGE_MIN_TOPUP_INTERVAL_MS) {
				log.debug({ msSinceLast }, "Rate limited");
				return { ...emptyResult, velocityLimited: true };
			}
		}

		// 9. Cap check + pack sizing
		const creditsNeeded = Math.abs(deficitCredits) + OVERAGE_INCREMENT_CREDITS;
		let packsNeeded = Math.ceil(creditsNeeded / TOP_UP_PRODUCT.credits);
		let costCents = packsNeeded * TOP_UP_PRODUCT.priceCents;

		const capCents = settings.overage_cap_cents;
		if (capCents !== null) {
			const remainingCapCents = capCents - overageUsedCents;
			if (remainingCapCents <= 0) {
				log.info({ used: overageUsedCents, cap: capCents }, "Cap exhausted");
				return { ...emptyResult, capExhausted: true };
			}
			const maxPacksByBudget = Math.floor(remainingCapCents / TOP_UP_PRODUCT.priceCents);
			if (maxPacksByBudget <= 0) {
				log.info({ remaining: remainingCapCents }, "Cap too low for even one pack");
				return { ...emptyResult, capExhausted: true };
			}
			if (packsNeeded > maxPacksByBudget) {
				packsNeeded = maxPacksByBudget;
				costCents = packsNeeded * TOP_UP_PRODUCT.priceCents;
			}
		}

		// 10. Autumn calls
		const totalCredits = packsNeeded * TOP_UP_PRODUCT.credits;
		log.info({ packsNeeded, costCents, totalCredits, deficitCredits }, "Attempting auto-top-up");

		try {
			for (let i = 0; i < packsNeeded; i++) {
				const result = await autumnAutoTopUp(
					org.autumnCustomerId!,
					TOP_UP_PRODUCT.productId,
					TOP_UP_PRODUCT.credits,
				);
				if (result.requiresCheckout) {
					// No payment method on file — trip circuit breaker
					log.warn("Payment method required — tripping circuit breaker");
					await tx
						.update(organization)
						.set({ overageDeclineAt: new Date() })
						.where(eq(organization.id, orgId));
					return { ...emptyResult, circuitBreakerTripped: true };
				}
			}
		} catch (err) {
			// Card decline or Autumn error — trip circuit breaker
			log.error({ err, alert: true }, "Auto-top-up failed — tripping circuit breaker");
			await tx
				.update(organization)
				.set({
					overageDeclineAt: new Date(),
					billingState: "exhausted",
					graceEnteredAt: null,
					graceExpiresAt: null,
				})
				.where(eq(organization.id, orgId));
			shouldEnforce = true;
			return { ...emptyResult, circuitBreakerTripped: true };
		}

		// 11. Success — update overage accounting
		const newUsedCents = overageUsedCents + costCents;
		const newTopupCount = overageTopupCount + packsNeeded;
		await tx
			.update(organization)
			.set({
				overageUsedCents: newUsedCents,
				overageTopupCount: newTopupCount,
				overageLastTopupAt: new Date(),
			})
			.where(eq(organization.id, orgId));

		log.info(
			{ packsCharged: packsNeeded, creditsAdded: totalCredits, chargedCents: costCents },
			"Auto-top-up succeeded",
		);

		return {
			success: true,
			packsCharged: packsNeeded,
			creditsAdded: totalCredits,
			chargedCents: costCents,
		};
	});

	// Post-transaction: enforce credits exhausted (after DB changes are committed)
	if (shouldEnforce) {
		try {
			await enforceCreditsExhausted(orgId);
		} catch (enforceErr) {
			log.error({ err: enforceErr }, "Failed to enforce after decline");
		}
	}

	// Post-transaction: credit shadow balance outside the advisory lock
	if (txResult.success && txResult.creditsAdded > 0) {
		try {
			await addShadowBalance(
				orgId,
				txResult.creditsAdded,
				`Auto-top-up overage (${txResult.packsCharged}x pack)`,
			);
		} catch (err) {
			log.error({ err }, "Auto-top-up succeeded but shadow balance credit failed");
		}
	}

	return txResult;
}
