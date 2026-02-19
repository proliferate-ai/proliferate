/**
 * GET /api/billing
 *
 * DEPRECATED — thin adapter mirroring oRPC `billing.getInfo` logic.
 * Use the oRPC procedure instead: GET /api/rpc/billing.getInfo
 * Will be removed after deprecation window (see billing-metering.md §10.6 D3).
 */

import { requireAuth } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
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

const log = logger.child({ route: "billing" });

const deprecationHeaders = {
	Deprecation: "true",
	Link: '</api/rpc/billing.getInfo>; rel="successor-version"',
} as const;

export async function GET() {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const org = await orgs.getBillingInfoV2(orgId);
	if (!org) {
		log.error("Org lookup failed");
		return NextResponse.json({ error: "Organization not found" }, { status: 404 });
	}

	let autumnCustomer = null;
	if (org.autumnCustomerId) {
		try {
			autumnCustomer = await autumnGetCustomer(org.autumnCustomerId);
		} catch (err) {
			log.error({ err }, "Failed to fetch Autumn customer");
		}
	}

	const selectedPlan = org.billingPlan === "pro" ? "pro" : "dev";
	const activeProduct = autumnCustomer?.products?.find(
		(p: { status: string }) => p.status === "active",
	);
	const hasActiveSubscription = Boolean(activeProduct);
	const plan = (activeProduct?.id as "dev" | "pro" | undefined) ?? selectedPlan;
	const planConfig = PLAN_CONFIGS[plan] ?? PLAN_CONFIGS.dev;

	const creditsFeature = autumnCustomer?.features[AUTUMN_FEATURES.credits];
	const concurrentFeature = autumnCustomer?.features[AUTUMN_FEATURES.maxConcurrentSessions];
	const snapshotsFeature = autumnCustomer?.features[AUTUMN_FEATURES.maxSnapshots];

	// V2: Credit math aligned with oRPC billing.getInfo
	const billingState = org.billingState as BillingState;
	const shadowBalance = Number(org.shadowBalance ?? 0);
	const graceExpiresAt = org.graceExpiresAt;
	const canStart = canPossiblyStart(billingState, graceExpiresAt);
	const stateMessage = getStateMessage(billingState, { graceExpiresAt, shadowBalance });
	const isTrial = billingState === "trial";
	// Use shadow balance for all non-active states (matches oRPC)
	const useShadowBalance = billingState !== "active";
	const creditsIncluded = isTrial
		? TRIAL_CREDITS
		: (creditsFeature?.included_usage ?? planConfig.creditsIncluded);
	const creditsBalance = useShadowBalance
		? shadowBalance
		: (creditsFeature?.balance ?? planConfig.creditsIncluded);
	const creditsUsed = useShadowBalance
		? Math.max(0, creditsIncluded - creditsBalance)
		: (creditsFeature?.usage ?? 0);

	return NextResponse.json(
		{
			plan: {
				id: plan,
				name: planConfig.name,
				monthlyPriceCents: planConfig.monthlyPriceCents,
				creditsIncluded: planConfig.creditsIncluded,
			},
			selectedPlan,
			hasActiveSubscription,
			credits: {
				balance: creditsBalance,
				used: creditsUsed,
				included: creditsIncluded,
				nextResetAt:
					!useShadowBalance && creditsFeature?.next_reset_at
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
			},
			overage: {
				usedCents: org.overageUsedCents,
				capCents: org.billingSettings?.overage_cap_cents ?? null,
				cycleMonth: org.overageCycleMonth,
				topupCount: org.overageTopupCount,
				circuitBreakerActive: !!org.overageDeclineAt,
			},
			state: {
				billingState,
				shadowBalance,
				graceExpiresAt: graceExpiresAt?.toISOString() ?? null,
				canStartSession: canStart,
				stateMessage,
			},
		},
		{ headers: deprecationHeaders },
	);
}
