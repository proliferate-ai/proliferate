/**
 * GET /api/billing
 *
 * Get billing information for the current organization.
 * Returns plan details, credit balances, and usage stats.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { orgs } from "@proliferate/services";
import {
	AUTUMN_FEATURES,
	type BillingState,
	PLAN_CONFIGS,
	TRIAL_CREDITS,
	autumnGetCustomer,
	canPossiblyStart,
	getStateMessage,
} from "@proliferate/shared/billing";
import { NextResponse } from "next/server";

export async function GET() {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	// Get organization details with billing settings
	const org = await orgs.getBillingInfoV2(orgId);
	if (!org) {
		console.error("[billing] Org lookup failed");
		return NextResponse.json({ error: "Organization not found" }, { status: 404 });
	}

	// Get billing info from Autumn (plan comes from here)
	let autumnCustomer = null;
	if (org.autumnCustomerId) {
		try {
			autumnCustomer = await autumnGetCustomer(org.autumnCustomerId);
		} catch (err) {
			console.error("[billing] Failed to fetch Autumn customer:", err);
			// Continue without Autumn data - show defaults
		}
	}

	const selectedPlan = org.billingPlan === "pro" ? "pro" : "dev";

	// Get plan from Autumn products array or default to selected plan
	// Autumn returns products as array, get the first active one
	const activeProduct = autumnCustomer?.products?.find(
		(p: { status: string }) => p.status === "active",
	);
	const hasActiveSubscription = Boolean(activeProduct);
	const plan = (activeProduct?.id as "dev" | "pro" | undefined) ?? selectedPlan;
	const planConfig = PLAN_CONFIGS[plan] ?? PLAN_CONFIGS.dev;

	// Build response - get features from Autumn
	const creditsFeature = autumnCustomer?.features[AUTUMN_FEATURES.credits];
	const concurrentFeature = autumnCustomer?.features[AUTUMN_FEATURES.maxConcurrentSessions];
	const snapshotsFeature = autumnCustomer?.features[AUTUMN_FEATURES.maxSnapshots];

	const billingState = org.billingState as BillingState;
	const shadowBalance = Number(org.shadowBalance ?? 0);
	const graceExpiresAt = org.graceExpiresAt;
	const canStartSession = canPossiblyStart(billingState, graceExpiresAt);
	const stateMessage = getStateMessage(billingState, { graceExpiresAt, shadowBalance });
	const isTrial = billingState === "trial" && !hasActiveSubscription;
	const trialCreditsUsed = Math.max(0, TRIAL_CREDITS - shadowBalance);

	return NextResponse.json({
		plan: {
			id: plan,
			name: planConfig.name,
			monthlyPriceCents: planConfig.monthlyPriceCents,
			creditsIncluded: planConfig.creditsIncluded,
		},
		selectedPlan,
		hasActiveSubscription,
		credits: {
			// Use Autumn balance if available, otherwise plan defaults
			balance: creditsFeature?.balance ?? (isTrial ? shadowBalance : planConfig.creditsIncluded),
			used: creditsFeature?.usage ?? (isTrial ? trialCreditsUsed : 0),
			included:
				creditsFeature?.included_usage ?? (isTrial ? TRIAL_CREDITS : planConfig.creditsIncluded),
			nextResetAt: creditsFeature?.next_reset_at
				? new Date(creditsFeature.next_reset_at * 1000).toISOString()
				: null,
		},
		limits: {
			maxConcurrentSessions: concurrentFeature?.balance ?? planConfig.maxConcurrentSessions,
			maxSnapshots: snapshotsFeature?.balance ?? planConfig.maxSnapshots,
			snapshotRetentionDays: planConfig.snapshotRetentionDays,
		},
		billingSettings: org.billingSettings || {
			overage_policy: "pause",
			overage_cap_cents: null,
			overage_used_this_month_cents: 0,
		},
		state: {
			billingState,
			shadowBalance,
			graceExpiresAt: graceExpiresAt?.toISOString() ?? null,
			canStartSession,
			stateMessage,
		},
	});
}
