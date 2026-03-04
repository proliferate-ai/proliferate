/**
 * Billing oRPC router.
 *
 * Handles credit purchases and billing operations.
 */

import { getUserOrgRole } from "@/lib/auth/permissions";
import { isBillingEnabled } from "@/lib/infra/billing";
import { logger } from "@/lib/infra/logger";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { createBillingFastReconcileQueue } from "@proliferate/queue";
import { billing, orgs } from "@proliferate/services";
import {
	AUTUMN_FEATURES,
	AUTUMN_PRODUCTS,
	type BillingState,
	PLAN_CONFIGS,
	TOP_UP_PRODUCT,
	TRIAL_CREDITS,
	autumnAttach,
	autumnGetCustomer,
	canPossiblyStart,
	getStateMessage,
} from "@proliferate/shared/billing";
import {
	ActivatePlanResponseSchema,
	BillingInfoSchema,
	BillingSettingsSchema,
	BuyCreditsResponseSchema,
	UpdateBillingSettingsResponseSchema,
} from "@proliferate/shared/contracts/billing";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "billing" });

/** Fire-and-forget fast reconcile enqueue. Failures are non-fatal. */
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

const DEFAULT_BILLING_SETTINGS = {
	overage_policy: "pause" as const,
	overage_cap_cents: null as number | null,
};

// ============================================
// Router
// ============================================

export const billingRouter = {
	/**
	 * Get billing information for the current organization.
	 * Returns plan details, credit balances, limits, settings, and V2 state.
	 */
	getInfo: orgProcedure
		.input(z.object({}).optional())
		.output(BillingInfoSchema)
		.handler(async ({ context }) => {
			// Get organization details with billing settings (V2)
			const org = await orgs.getBillingInfoV2(context.orgId);
			if (!org) {
				log.error("Org lookup failed");
				throw new ORPCError("NOT_FOUND", {
					message: "Organization not found",
				});
			}

			const selectedPlan = org.billingPlan === "pro" ? "pro" : "dev";

			// Get billing info from Autumn (plan comes from here)
			let autumnCustomer = null;
			if (org.autumnCustomerId) {
				try {
					autumnCustomer = await autumnGetCustomer(org.autumnCustomerId);
				} catch (err) {
					log.error({ err }, "Failed to fetch Autumn customer");
					// Continue without Autumn data - show defaults
				}
			}

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

			// V2: Calculate state info
			const billingState = org.billingState as BillingState;
			const shadowBalance = Number(org.shadowBalance ?? 0);
			const graceExpiresAt = org.graceExpiresAt;
			const canStart = canPossiblyStart(billingState, graceExpiresAt);
			const stateMessage = getStateMessage(billingState, {
				graceExpiresAt,
				shadowBalance,
			});
			const isTrial = billingState === "trial";
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

			return {
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
				billingSettings: org.billingSettings || DEFAULT_BILLING_SETTINGS,
				overage: {
					usedCents: org.overageUsedCents,
					capCents: org.billingSettings?.overage_cap_cents ?? null,
					cycleMonth: org.overageCycleMonth,
					topupCount: org.overageTopupCount,
					circuitBreakerActive: !!org.overageDeclineAt,
				},
				// V2 state
				state: {
					billingState,
					shadowBalance,
					graceExpiresAt: graceExpiresAt?.toISOString() ?? null,
					canStartSession: canStart,
					stateMessage,
				},
			};
		}),

	/**
	 * Update billing settings for the current organization.
	 * Only admins/owners can update settings.
	 */
	updateSettings: orgProcedure
		.input(
			z.object({
				overage_policy: z.enum(["pause", "allow"]).optional(),
				overage_cap_cents: z.number().nullable().optional(),
			}),
		)
		.output(UpdateBillingSettingsResponseSchema)
		.handler(async ({ context, input }) => {
			// Only admins/owners can update billing settings
			const role = await getUserOrgRole(context.user.id, context.orgId);
			if (!role || role === "member") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins can update billing settings",
				});
			}

			// Get current settings
			const org = await orgs.getBillingInfo(context.orgId);
			if (!org) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to fetch current settings",
				});
			}

			const currentSettings = org.billingSettings ?? DEFAULT_BILLING_SETTINGS;

			// Merge updates
			const newSettings = {
				...currentSettings,
				...(input.overage_policy !== undefined && { overage_policy: input.overage_policy }),
				...(input.overage_cap_cents !== undefined && {
					overage_cap_cents: input.overage_cap_cents,
				}),
			};

			// Update
			await orgs.updateBillingSettings(context.orgId, newSettings);

			return { success: true, settings: newSettings };
		}),

	/**
	 * Activate the selected plan (dev/pro) after trial credits are exhausted.
	 * Returns a checkout URL if payment method is required.
	 */
	activatePlan: orgProcedure
		.input(z.object({ plan: z.enum(["dev", "pro"]).optional() }).optional())
		.output(ActivatePlanResponseSchema)
		.handler(async ({ context, input }) => {
			// Only admins/owners can activate plans
			const role = await getUserOrgRole(context.user.id, context.orgId);
			if (!role || role === "member") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins can activate plans",
				});
			}

			if (!isBillingEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Billing is not enabled",
				});
			}

			const org = await orgs.getBillingInfoV2(context.orgId);
			if (!org) {
				throw new ORPCError("NOT_FOUND", {
					message: "Organization not found",
				});
			}

			const plan = input?.plan ?? (org.billingPlan === "pro" ? "pro" : "dev");
			await orgs.updateBillingPlan(context.orgId, plan);

			const baseUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
			const result = await autumnAttach({
				customer_id: org.autumnCustomerId ?? context.orgId,
				product_id: AUTUMN_PRODUCTS[plan],
				success_url: `${baseUrl}/onboarding/complete?return=/settings/billing`,
				cancel_url: `${baseUrl}/settings/billing`,
				customer_data: {
					email: context.user.email,
					name: org.name,
				},
			});

			const customerId = result.customer?.id ?? org.autumnCustomerId ?? context.orgId;
			if (customerId && customerId !== org.autumnCustomerId) {
				await orgs.updateAutumnCustomerId(context.orgId, customerId);
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
				log.error({ err }, "Failed to fetch customer after plan activation");
			}

			await orgs.initializeBillingState(context.orgId, "active", includedCredits);

			// Trigger fast reconcile to sync shadow balance with Autumn
			await enqueueFastReconcile(context.orgId, "payment_webhook");

			return {
				success: true,
				message: "Plan activated",
			};
		}),

	/**
	 * Purchase additional credits.
	 * Returns a Stripe checkout URL or confirms credits added directly.
	 */
	buyCredits: orgProcedure
		.input(z.object({ quantity: z.number().int().min(1).max(10).default(1) }).optional())
		.output(BuyCreditsResponseSchema)
		.handler(async ({ context, input }) => {
			// Only admins/owners can purchase credits
			const role = await getUserOrgRole(context.user.id, context.orgId);
			if (!role || role === "member") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only admins can purchase credits",
				});
			}

			if (!isBillingEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Billing is not enabled",
				});
			}

			// Verify org exists
			const org = await orgs.getBillingInfo(context.orgId);

			if (!org) {
				throw new ORPCError("NOT_FOUND", {
					message: "Organization not found",
				});
			}

			try {
				const baseUrl = env.NEXT_PUBLIC_APP_URL;
				const quantity = input?.quantity ?? 1;
				const totalCredits = TOP_UP_PRODUCT.credits * quantity;
				const totalPriceCents = TOP_UP_PRODUCT.priceCents * quantity;

				// Attach the top_up product once per pack.
				// We don't pass `options` because the product's default credit
				// amount is configured in Autumn. Repeated attaches for quantity > 1.
				const firstResult = await autumnAttach({
					customer_id: context.orgId,
					product_id: TOP_UP_PRODUCT.productId,
					success_url: `${baseUrl}/settings/billing?success=credits`,
					cancel_url: `${baseUrl}/settings/billing?canceled=credits`,
					customer_data: {
						email: context.user.email,
						name: org.name,
					},
				});

				const checkoutUrl = firstResult.checkout_url ?? firstResult.url;
				if (checkoutUrl) {
					// Customer needs to complete checkout — can only buy 1 pack at a time
					return {
						success: true,
						checkoutUrl,
						credits: TOP_UP_PRODUCT.credits,
						priceCents: TOP_UP_PRODUCT.priceCents,
					};
				}

				// Payment method on file — attach remaining packs
				for (let i = 1; i < quantity; i++) {
					await autumnAttach({
						customer_id: context.orgId,
						product_id: TOP_UP_PRODUCT.productId,
						customer_data: {
							email: context.user.email,
							name: org.name,
						},
					});
				}

				// Update shadow balance for all packs
				try {
					await billing.addShadowBalance(
						context.orgId,
						totalCredits,
						`Credit top-up (${quantity}x pack, payment method on file)`,
						context.user.id,
					);
				} catch (err) {
					log.error({ err }, "Failed to update shadow balance");
				}

				// Trigger fast reconcile to sync shadow balance with Autumn
				await enqueueFastReconcile(context.orgId, "payment_webhook");

				return {
					success: true,
					message: `${totalCredits} credits added to your account`,
					credits: totalCredits,
				};
			} catch (err) {
				log.error({ err }, "Failed to process credit purchase");
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Failed to process purchase",
				});
			}
		}),

	/**
	 * Get usage summary for the current billing period.
	 */
	getUsageSummary: orgProcedure
		.input(z.object({}).optional())
		.output(
			z.object({
				totalCredits: z.number(),
				computeCredits: z.number(),
				llmCredits: z.number(),
				eventCount: z.number(),
				periodStart: z.string(),
				periodEnd: z.string(),
			}),
		)
		.handler(async ({ context }) => {
			const now = new Date();
			const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
			const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

			const rows = await billing.getUsageSummary(context.orgId, periodStart, periodEnd);

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
		}),

	/**
	 * Get top cost drivers for the current billing period.
	 */
	getCostDrivers: orgProcedure
		.input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
		.output(
			z.array(
				z.object({
					label: z.string(),
					entityId: z.string().nullable(),
					entityType: z.string(),
					credits: z.number(),
					eventCount: z.number(),
					percentage: z.number(),
				}),
			),
		)
		.handler(async ({ context, input }) => {
			const now = new Date();
			const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
			const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

			const rows = await billing.getTopCostDrivers(
				context.orgId,
				periodStart,
				periodEnd,
				input?.limit ?? 10,
			);

			// Compute total for percentage calculation
			const totalCredits = rows.reduce((sum, r) => sum + Number(r.totalCredits), 0);

			return rows.map((row) => {
				const credits = Number(row.totalCredits);
				return {
					label: row.sessionId ? `Session ${row.sessionId.slice(0, 8)}` : "Unknown",
					entityId: row.sessionId,
					entityType: "session" as const,
					credits,
					eventCount: row.eventCount,
					percentage: totalCredits > 0 ? (credits / totalCredits) * 100 : 0,
				};
			});
		}),

	/**
	 * Get recent billing events with pagination.
	 */
	getRecentEvents: orgProcedure
		.input(
			z
				.object({
					limit: z.number().int().min(1).max(100).default(20),
					offset: z.number().int().min(0).default(0),
					eventType: z.enum(["compute", "llm"]).optional(),
				})
				.optional(),
		)
		.output(
			z.object({
				events: z.array(
					z.object({
						id: z.string(),
						eventType: z.string(),
						credits: z.number(),
						quantity: z.number(),
						status: z.string(),
						sessionIds: z.array(z.string()).nullable(),
						metadata: z.record(z.unknown()).nullable(),
						createdAt: z.string(),
					}),
				),
				total: z.number(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { events, total } = await billing.listBillingEvents({
				orgId: context.orgId,
				limit: input?.limit ?? 20,
				offset: input?.offset ?? 0,
				eventType: input?.eventType,
			});

			return {
				events: events.map((e) => ({
					id: e.id,
					eventType: e.eventType,
					credits: Number(e.credits),
					quantity: Number(e.quantity),
					status: e.status,
					sessionIds: e.sessionIds,
					metadata: e.metadata,
					createdAt: e.createdAt.toISOString(),
				})),
				total,
			};
		}),

	/**
	 * Get entitlement status (current usage vs plan limits).
	 */
	getEntitlementStatus: orgProcedure
		.input(z.object({}).optional())
		.output(
			z.object({
				concurrentSessions: z.object({ current: z.number(), max: z.number() }),
				activeCoworkers: z.object({ current: z.number(), max: z.number() }),
				monthlyUsage: z.object({
					used: z.number(),
					included: z.number(),
					warningLevel: z.enum(["none", "approaching", "critical", "exhausted"]),
				}),
			}),
		)
		.handler(async ({ context }) => {
			const status = await billing.getEntitlementStatus(context.orgId);

			if (!status) {
				// Billing disabled — return unlimited defaults
				return {
					concurrentSessions: { current: 0, max: 999 },
					activeCoworkers: { current: 0, max: 999 },
					monthlyUsage: { used: 0, included: 0, warningLevel: "none" as const },
				};
			}

			return {
				...status,
				monthlyUsage: {
					...status.monthlyUsage,
					warningLevel: status.monthlyUsage.warningLevel as
						| "none"
						| "approaching"
						| "critical"
						| "exhausted",
				},
			};
		}),
};
