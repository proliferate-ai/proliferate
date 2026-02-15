/**
 * Billing utilities for web API routes.
 *
 * Session gating is handled by the domain gate in @proliferate/services/billing.
 * This file provides helpers for billing configuration checks and dashboard queries.
 */

import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";

const log = logger.child({ module: "billing" });

// ============================================
// Configuration
// ============================================

/**
 * Check if billing system is enabled.
 * Used by billing/onboarding routes to short-circuit non-gating operations.
 *
 * NOTE: The billing gate itself (checkBillingGateForOrg / assertBillingGateForOrg)
 * checks this internally — callers of the gate do NOT need to check this first.
 */
export function isBillingEnabled(): boolean {
	return env.NEXT_PUBLIC_BILLING_ENABLED;
}

// ============================================
// Dashboard Helpers
// ============================================

/**
 * Get billing status for an organization.
 * Used by the dashboard to show credit balance and plan info.
 */
export async function getOrgBillingStatus(orgId: string): Promise<{
	configured: boolean;
	credits?: { balance: number; usage: number; included: number };
	plan?: string;
}> {
	if (!isBillingEnabled()) {
		return { configured: false };
	}

	const org = await orgs.getBillingInfo(orgId);

	if (!org?.autumnCustomerId) {
		return { configured: false };
	}

	try {
		const { autumnGetCustomer } = await import("@proliferate/shared/billing");

		const customer = await autumnGetCustomer(org.autumnCustomerId);

		const creditsFeature = customer.features?.credits;

		const activeProduct = customer.products?.find((p) => p.status === "active");
		return {
			configured: true,
			credits: creditsFeature
				? {
						balance: creditsFeature.balance ?? 0,
						usage: creditsFeature.usage ?? 0,
						included: creditsFeature.included_usage ?? 0,
					}
				: undefined,
			plan: activeProduct?.id ?? undefined,
		};
	} catch (err) {
		log.error({ err, orgId }, "Failed to get billing status for org");
		return { configured: false };
	}
}
