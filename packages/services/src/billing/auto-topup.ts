/**
 * Auto-recharge service for auto_recharge_enabled orgs.
 *
 * When an org has auto_recharge_enabled = true and balance goes negative,
 * this module auto-charges using the default recharge pack to keep sessions running.
 *
 * Key invariants:
 * - Auto-recharge happens OUTSIDE the shadow balance FOR UPDATE transaction
 * - Uses pg_advisory_xact_lock to prevent concurrent recharges per org
 * - Circuit breaker trips on card decline → forces exhausted state directly
 * - Velocity + rate limits prevent runaway charges
 */

import {
	DEFAULT_AUTO_RECHARGE_PACK,
	OVERAGE_MAX_TOPUPS_PER_CYCLE,
	OVERAGE_MIN_TOPUP_INTERVAL_MS,
	type OverageTopUpResult,
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
 * Attempt an auto-recharge for an org with auto_recharge_enabled = true.
 *
 * Called after deductShadowBalance detects enforcement is needed.
 * Returns success=true if credits were added (caller should skip enforcement).
 */
export async function attemptAutoRecharge(
	orgId: string,
	deficitCredits: number,
): Promise<OverageTopUpResult> {
	const log = getServicesLogger().child({ module: "auto-recharge", orgId });
	const db = getDb();

	// 1. Load org recharge state
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
	if (!settings.auto_recharge_enabled) {
		return emptyResult;
	}

	if (!org.autumnCustomerId) {
		log.warn("No Autumn customer ID — cannot auto-recharge");
		return emptyResult;
	}

	// 3. Circuit breaker check
	if (org.overageDeclineAt) {
		log.info("Circuit breaker active — skipping auto-recharge");
		return { ...emptyResult, circuitBreakerTripped: true };
	}

	// Use advisory lock transaction to prevent concurrent recharges.
	// Enforcement and shadow balance updates happen AFTER the transaction commits.
	let shouldEnforce = false;
	const pack = DEFAULT_AUTO_RECHARGE_PACK;
	const txResult = await db.transaction(async (tx) => {
		// 4. Acquire advisory lock (per-org, distinct from shadow balance lock)
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orgId} || ':auto_topup'))`);

		// 5. Re-read state under lock (another caller may have recharged)
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

		// If balance is now positive (another caller recharged), skip
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
			log.info({ newCycle: currentCycle }, "Recharge cycle reset");
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
		const creditsNeeded = Math.abs(deficitCredits) + pack.credits;
		let packsNeeded = Math.ceil(creditsNeeded / pack.credits);
		let costCents = packsNeeded * pack.priceCents;

		const capCents = settings.overage_cap_cents;
		if (capCents !== null) {
			const remainingCapCents = capCents - overageUsedCents;
			if (remainingCapCents <= 0) {
				log.info({ used: overageUsedCents, cap: capCents }, "Cap exhausted");
				return { ...emptyResult, capExhausted: true };
			}
			const maxPacksByBudget = Math.floor(remainingCapCents / pack.priceCents);
			if (maxPacksByBudget <= 0) {
				log.info({ remaining: remainingCapCents }, "Cap too low for even one pack");
				return { ...emptyResult, capExhausted: true };
			}
			if (packsNeeded > maxPacksByBudget) {
				packsNeeded = maxPacksByBudget;
				costCents = packsNeeded * pack.priceCents;
			}
		}

		// 10. Autumn calls
		const totalCredits = packsNeeded * pack.credits;
		log.info({ packsNeeded, costCents, totalCredits, deficitCredits }, "Attempting auto-recharge");

		try {
			for (let i = 0; i < packsNeeded; i++) {
				const result = await autumnAutoTopUp(org.autumnCustomerId!, pack.productId, pack.credits);
				if (result.requiresCheckout) {
					// No payment method on file — trip circuit breaker
					log.warn("Payment method required — tripping circuit breaker");
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
			}
		} catch (err) {
			// Card decline or Autumn error — trip circuit breaker, go straight to exhausted
			log.error({ err, alert: true }, "Auto-recharge failed — tripping circuit breaker");
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

		// 11. Success — update recharge accounting
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
			"Auto-recharge succeeded",
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
				`Auto-recharge (${txResult.packsCharged}x pack)`,
			);
		} catch (err) {
			log.error({ err }, "Auto-recharge succeeded but shadow balance credit failed");
		}
	}

	return txResult;
}
