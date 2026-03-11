/**
 * Billing service.
 *
 * Business logic for billing page and checkout flows.
 */

import { env } from "@proliferate/environment/server";
import { createBillingFastReconcileQueue } from "@proliferate/queue";
import {
	AUTUMN_FEATURES,
	AUTUMN_PRODUCTS,
	DEFAULT_BILLING_SETTINGS,
	PLAN_CONFIGS,
	TOP_UP_PACKS,
	type TopUpPackId,
	autumnAttach,
	autumnBillingPortal,
	autumnGetCustomer,
	autumnSetupPayment,
	canPossiblyStart,
	getStateMessage,
	normalizeBillingState,
	parseBillingSettings,
} from "@proliferate/shared/billing";
import type {
	ActivatePlanResponse,
	BillingInfo,
	BillingSettings,
	BuyCreditsResponse,
	SetupPaymentResponse,
	UpdateBillingSettingsResponse,
} from "@proliferate/shared/contracts/billing";
import { getServicesLogger } from "../logger";
import {
	getBillingInfo,
	getBillingInfoV2,
	getUserRole,
	initializeBillingState,
	updateAutumnCustomerId,
	updateBillingPlan,
	updateBillingSettings,
} from "../orgs/service";
import { getTopCostDrivers, getUsageSummary, listBillingEvents } from "./db";
import { getEntitlementStatus } from "./gate";
import { addShadowBalance } from "./shadow-balance";

const log = getServicesLogger().child({ module: "billing-service" });

export class BillingForbiddenError extends Error {
	constructor(message = "Only admins can perform this billing action") {
		super(message);
		this.name = "BillingForbiddenError";
	}
}

export class BillingNotFoundError extends Error {
	constructor(message = "Organization not found") {
		super(message);
		this.name = "BillingNotFoundError";
	}
}

export class BillingDisabledError extends Error {
	constructor(message = "Billing is not enabled") {
		super(message);
		this.name = "BillingDisabledError";
	}
}

function isBillingEnabled(): boolean {
	return Boolean(env.NEXT_PUBLIC_BILLING_ENABLED);
}

async function enqueueFastReconcile(orgId: string, trigger: "payment_webhook" | "manual") {
	const queue = createBillingFastReconcileQueue();
	try {
		await queue.add("fast-reconcile", { orgId, trigger }, { jobId: orgId });
	} catch (err) {
		log.warn({ err, orgId }, "Failed to enqueue fast reconcile");
	} finally {
		await queue.close().catch((err) => {
			log.debug({ err, orgId }, "Failed to close fast reconcile queue");
		});
	}
}

export async function assertBillingAdmin(userId: string, orgId: string): Promise<void> {
	const role = await getUserRole(userId, orgId);
	if (!role || role === "member") {
		throw new BillingForbiddenError();
	}
}

export async function getOrgBillingInfo(orgId: string): Promise<BillingInfo> {
	const org = await getBillingInfoV2(orgId);
	if (!org) {
		throw new BillingNotFoundError();
	}

	const selectedPlan = org.billingPlan === "pro" ? "pro" : "dev";

	let autumnCustomer = null;
	if (org.autumnCustomerId) {
		try {
			autumnCustomer = await autumnGetCustomer(org.autumnCustomerId);
		} catch (err) {
			log.error({ err, orgId }, "Failed to fetch Autumn customer");
		}
	}

	const activeProduct = autumnCustomer?.products?.find(
		(p: { status: string }) => p.status === "active",
	);
	const hasActiveSubscription = Boolean(activeProduct);
	// Payment method is expanded from Autumn — null/undefined means no card on file
	const hasPaymentMethod = autumnCustomer?.payment_method != null;
	const plan = (activeProduct?.id as "dev" | "pro" | undefined) ?? selectedPlan;
	const planConfig = PLAN_CONFIGS[plan] ?? PLAN_CONFIGS.dev;

	const creditsFeature = autumnCustomer?.features[AUTUMN_FEATURES.credits];
	const concurrentFeature = autumnCustomer?.features[AUTUMN_FEATURES.maxConcurrentSessions];
	const snapshotsFeature = autumnCustomer?.features[AUTUMN_FEATURES.maxSnapshots];

	const billingState = normalizeBillingState(org.billingState);
	const shadowBalance = Number(org.shadowBalance ?? 0);
	const graceExpiresAt = org.graceExpiresAt;
	const canStart = canPossiblyStart(billingState, graceExpiresAt);
	const stateMessage = getStateMessage(billingState, {
		graceExpiresAt,
		shadowBalance,
	});
	const isFree = billingState === "free";
	const useShadowBalance = billingState !== "active";
	const creditsIncluded = isFree
		? 0 // Free tier has no "included" credits — they're granted once
		: (creditsFeature?.included_usage ?? planConfig.creditsIncluded);
	const creditsBalance = useShadowBalance
		? shadowBalance
		: (creditsFeature?.balance ?? planConfig.creditsIncluded);
	const creditsUsed = useShadowBalance
		? Math.max(0, creditsIncluded - creditsBalance)
		: (creditsFeature?.usage ?? 0);

	return {
		plan: {
			id: plan,
			name: planConfig.name,
			monthlyPriceCents: planConfig.monthlyPriceCents,
			creditsIncluded: planConfig.creditsIncluded,
		},
		selectedPlan,
		hasActiveSubscription,
		hasPaymentMethod,
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
		billingSettings: parseBillingSettings(org.billingSettings),
		state: {
			billingState,
			shadowBalance,
			graceExpiresAt: graceExpiresAt?.toISOString() ?? null,
			canStartSession: canStart,
			stateMessage,
		},
	};
}

export async function updateOrgBillingSettings(
	orgId: string,
	input: Partial<BillingSettings>,
): Promise<UpdateBillingSettingsResponse> {
	const org = await getBillingInfo(orgId);
	if (!org) {
		throw new BillingNotFoundError("Failed to fetch current settings");
	}

	const currentSettings = org.billingSettings ?? DEFAULT_BILLING_SETTINGS;
	const newSettings = {
		...currentSettings,
		...(input.auto_recharge_enabled !== undefined && {
			auto_recharge_enabled: input.auto_recharge_enabled,
		}),
		...(input.overage_cap_cents !== undefined && { overage_cap_cents: input.overage_cap_cents }),
	};

	await updateBillingSettings(orgId, newSettings);
	return { success: true, settings: newSettings };
}

export async function setupOrgPaymentMethod(input: {
	orgId: string;
	userEmail: string;
	appUrl: string;
}): Promise<SetupPaymentResponse> {
	if (!isBillingEnabled()) {
		throw new BillingDisabledError();
	}

	const org = await getBillingInfoV2(input.orgId);
	if (!org) {
		throw new BillingNotFoundError();
	}

	const baseUrl = input.appUrl || "http://localhost:3000";
	const returnUrl = `${baseUrl}/settings/billing?success=payment`;

	// If customer already exists in Autumn, open billing portal
	if (org.autumnCustomerId) {
		try {
			const portal = await autumnBillingPortal(org.autumnCustomerId, returnUrl);
			return { success: true, checkoutUrl: portal.url };
		} catch (err) {
			log.warn({ err, orgId: input.orgId }, "Billing portal failed, falling back to setup_payment");
		}
	}

	// Otherwise, initiate payment method setup (creates customer if needed)
	const customerId = org.autumnCustomerId ?? input.orgId;
	const result = await autumnSetupPayment({
		customer_id: customerId,
		success_url: returnUrl,
		customer_data: {
			email: input.userEmail,
			name: org.name,
		},
	});

	// Persist customer ID if Autumn created a new customer
	if (!org.autumnCustomerId) {
		await updateAutumnCustomerId(input.orgId, customerId);
	}

	const checkoutUrl = result.checkout_url ?? result.url;
	if (checkoutUrl) {
		return { success: true, checkoutUrl };
	}

	return { success: true, message: "Payment method already on file" };
}

export async function activateOrgPlan(input: {
	orgId: string;
	userEmail: string;
	plan?: "dev" | "pro";
	appUrl: string;
}): Promise<ActivatePlanResponse> {
	if (!isBillingEnabled()) {
		throw new BillingDisabledError();
	}

	const org = await getBillingInfoV2(input.orgId);
	if (!org) {
		throw new BillingNotFoundError();
	}

	const plan = input.plan ?? (org.billingPlan === "pro" ? "pro" : "dev");
	await updateBillingPlan(input.orgId, plan);

	const baseUrl = input.appUrl || "http://localhost:3000";
	const result = await autumnAttach({
		customer_id: org.autumnCustomerId ?? input.orgId,
		product_id: AUTUMN_PRODUCTS[plan],
		success_url: `${baseUrl}/onboarding/complete?return=/settings/billing`,
		cancel_url: `${baseUrl}/settings/billing`,
		customer_data: {
			email: input.userEmail,
			name: org.name,
		},
	});

	const customerId = result.customer?.id ?? org.autumnCustomerId ?? input.orgId;
	if (customerId && customerId !== org.autumnCustomerId) {
		await updateAutumnCustomerId(input.orgId, customerId);
	}

	const checkoutUrl = result.checkout_url ?? result.url;
	if (checkoutUrl) {
		return {
			success: true,
			checkoutUrl,
			message: "Checkout required to activate plan",
		};
	}

	let includedCredits = PLAN_CONFIGS[plan].creditsIncluded;
	try {
		const customer = await autumnGetCustomer(customerId);
		const creditsFeature = customer.features[AUTUMN_FEATURES.credits];
		if (creditsFeature?.included_usage !== undefined) {
			includedCredits = creditsFeature.included_usage ?? includedCredits;
		}
	} catch (err) {
		log.error({ err, orgId: input.orgId }, "Failed to fetch customer after plan activation");
	}

	await initializeBillingState(input.orgId, "active", includedCredits);
	await enqueueFastReconcile(input.orgId, "payment_webhook");

	return {
		success: true,
		message: "Plan activated",
	};
}

export class BillingInvalidPackError extends Error {
	constructor(packId: string) {
		super(`Invalid top-up pack: ${packId}`);
		this.name = "BillingInvalidPackError";
	}
}

export async function buyOrgCredits(input: {
	orgId: string;
	userId: string;
	userEmail: string;
	packId: TopUpPackId;
	appUrl: string;
}): Promise<BuyCreditsResponse> {
	if (!isBillingEnabled()) {
		throw new BillingDisabledError();
	}

	const pack = TOP_UP_PACKS.find((p) => p.productId === input.packId);
	if (!pack) {
		throw new BillingInvalidPackError(input.packId);
	}

	const org = await getBillingInfo(input.orgId);
	if (!org) {
		throw new BillingNotFoundError();
	}

	const baseUrl = input.appUrl;

	const result = await autumnAttach({
		customer_id: input.orgId,
		product_id: pack.productId,
		success_url: `${baseUrl}/settings/billing?success=credits`,
		cancel_url: `${baseUrl}/settings/billing?canceled=credits`,
		customer_data: {
			email: input.userEmail,
			name: org.name,
		},
	});

	const checkoutUrl = result.checkout_url ?? result.url;
	if (checkoutUrl) {
		return {
			success: true,
			checkoutUrl,
			credits: pack.credits,
			priceCents: pack.priceCents,
		};
	}

	try {
		await addShadowBalance(
			input.orgId,
			pack.credits,
			`Credit top-up (${pack.name} pack, payment method on file)`,
			input.userId,
		);
	} catch (err) {
		log.error({ err, orgId: input.orgId }, "Failed to update shadow balance");
	}

	await enqueueFastReconcile(input.orgId, "payment_webhook");

	return {
		success: true,
		message: `${pack.credits} credits added to your account`,
		credits: pack.credits,
		priceCents: pack.priceCents,
	};
}

export async function getOrgUsageSummary(orgId: string): Promise<{
	totalCredits: number;
	computeCredits: number;
	llmCredits: number;
	eventCount: number;
	periodStart: string;
	periodEnd: string;
}> {
	const now = new Date();
	const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
	const rows = await getUsageSummary(orgId, periodStart, periodEnd);

	let computeCredits = 0;
	let llmCredits = 0;
	let eventCount = 0;

	for (const row of rows) {
		const credits = Number(row.totalCredits);
		eventCount += row.eventCount;
		if (row.eventType === "compute") {
			computeCredits = credits;
		} else if (row.eventType === "llm") {
			llmCredits = credits;
		}
	}

	return {
		totalCredits: computeCredits + llmCredits,
		computeCredits,
		llmCredits,
		eventCount,
		periodStart: periodStart.toISOString(),
		periodEnd: periodEnd.toISOString(),
	};
}

export async function getOrgCostDrivers(
	orgId: string,
	limit = 10,
): Promise<
	Array<{
		label: string;
		entityId: string | null;
		entityType: "session";
		credits: number;
		eventCount: number;
		percentage: number;
	}>
> {
	const now = new Date();
	const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
	const rows = await getTopCostDrivers(orgId, periodStart, periodEnd, limit);
	const totalCredits = rows.reduce((sum, row) => sum + Number(row.totalCredits), 0);

	return rows.map((row) => {
		const credits = Number(row.totalCredits);
		return {
			label: row.sessionId ? `Session ${row.sessionId.slice(0, 8)}` : "Unknown",
			entityId: row.sessionId,
			entityType: "session",
			credits,
			eventCount: row.eventCount,
			percentage: totalCredits > 0 ? (credits / totalCredits) * 100 : 0,
		};
	});
}

export async function getOrgRecentBillingEvents(input: {
	orgId: string;
	limit: number;
	offset: number;
	eventType?: "compute" | "llm";
}): Promise<{
	events: Array<{
		id: string;
		eventType: string;
		credits: number;
		quantity: number;
		status: string;
		sessionIds: string[] | null;
		metadata: Record<string, unknown> | null;
		createdAt: string;
	}>;
	total: number;
}> {
	const { events, total } = await listBillingEvents({
		orgId: input.orgId,
		limit: input.limit,
		offset: input.offset,
		eventType: input.eventType,
	});

	return {
		events: events.map((event) => ({
			id: event.id,
			eventType: event.eventType,
			credits: Number(event.credits),
			quantity: Number(event.quantity),
			status: event.status,
			sessionIds: event.sessionIds,
			metadata: event.metadata,
			createdAt: event.createdAt.toISOString(),
		})),
		total,
	};
}

export async function getOrgEntitlementStatus(orgId: string): Promise<{
	concurrentSessions: { current: number; max: number };
	activeCoworkers: { current: number; max: number };
}> {
	const status = await getEntitlementStatus(orgId);
	if (!status) {
		return {
			concurrentSessions: { current: 0, max: 999 },
			activeCoworkers: { current: 0, max: 999 },
		};
	}

	return status;
}
