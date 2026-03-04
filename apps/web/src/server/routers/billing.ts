/**
 * Billing oRPC router.
 *
 * Handles credit purchases and billing operations.
 */

import { logger } from "@/lib/infra/logger";
import { ORPCError } from "@orpc/server";
import { env } from "@proliferate/environment/server";
import { billing } from "@proliferate/services";
import {
	ActivatePlanResponseSchema,
	BillingInfoSchema,
	BuyCreditsResponseSchema,
	UpdateBillingSettingsResponseSchema,
} from "@proliferate/shared/contracts/billing";
import { z } from "zod";
import { orgProcedure } from "./middleware";

const log = logger.child({ handler: "billing" });

function throwMappedBillingError(
	err: unknown,
	options?: {
		forbiddenMessage?: string;
		internalMessage?: string;
	},
): never {
	if (err instanceof ORPCError) {
		throw err;
	}
	if (err instanceof billing.BillingForbiddenError) {
		throw new ORPCError("FORBIDDEN", {
			message: options?.forbiddenMessage ?? err.message,
		});
	}
	if (err instanceof billing.BillingDisabledError) {
		throw new ORPCError("BAD_REQUEST", {
			message: err.message,
		});
	}
	if (err instanceof billing.BillingNotFoundError) {
		throw new ORPCError("NOT_FOUND", {
			message: err.message,
		});
	}

	log.error({ err }, "Billing router handler failed");
	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message: options?.internalMessage ?? "Billing operation failed",
	});
}

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
			try {
				return await billing.getOrgBillingInfo(context.orgId);
			} catch (err) {
				throwMappedBillingError(err);
			}
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
			try {
				await billing.assertBillingAdmin(context.user.id, context.orgId);
				return await billing.updateOrgBillingSettings(context.orgId, input);
			} catch (err) {
				throwMappedBillingError(err, {
					forbiddenMessage: "Only admins can update billing settings",
					internalMessage: "Failed to update billing settings",
				});
			}
		}),

	/**
	 * Activate the selected plan (dev/pro) after trial credits are exhausted.
	 * Returns a checkout URL if payment method is required.
	 */
	activatePlan: orgProcedure
		.input(z.object({ plan: z.enum(["dev", "pro"]).optional() }).optional())
		.output(ActivatePlanResponseSchema)
		.handler(async ({ context, input }) => {
			try {
				await billing.assertBillingAdmin(context.user.id, context.orgId);
				return await billing.activateOrgPlan({
					orgId: context.orgId,
					userEmail: context.user.email,
					plan: input?.plan,
					appUrl: env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
				});
			} catch (err) {
				throwMappedBillingError(err, {
					forbiddenMessage: "Only admins can activate plans",
					internalMessage: "Failed to activate plan",
				});
			}
		}),

	/**
	 * Purchase additional credits.
	 * Returns a Stripe checkout URL or confirms credits added directly.
	 */
	buyCredits: orgProcedure
		.input(z.object({ quantity: z.number().int().min(1).max(10).default(1) }).optional())
		.output(BuyCreditsResponseSchema)
		.handler(async ({ context, input }) => {
			try {
				await billing.assertBillingAdmin(context.user.id, context.orgId);
				return await billing.buyOrgCredits({
					orgId: context.orgId,
					userId: context.user.id,
					userEmail: context.user.email,
					quantity: input?.quantity ?? 1,
					appUrl: env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
				});
			} catch (err) {
				throwMappedBillingError(err, {
					forbiddenMessage: "Only admins can purchase credits",
					internalMessage: "Failed to process purchase",
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
			try {
				return await billing.getOrgUsageSummary(context.orgId);
			} catch (err) {
				throwMappedBillingError(err, { internalMessage: "Failed to load usage summary" });
			}
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
			try {
				return await billing.getOrgCostDrivers(context.orgId, input?.limit ?? 10);
			} catch (err) {
				throwMappedBillingError(err, { internalMessage: "Failed to load cost drivers" });
			}
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
			try {
				return await billing.getOrgRecentBillingEvents({
					orgId: context.orgId,
					limit: input?.limit ?? 20,
					offset: input?.offset ?? 0,
					eventType: input?.eventType,
				});
			} catch (err) {
				throwMappedBillingError(err, { internalMessage: "Failed to load recent events" });
			}
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
			try {
				return await billing.getOrgEntitlementStatus(context.orgId);
			} catch (err) {
				throwMappedBillingError(err, { internalMessage: "Failed to load entitlement status" });
			}
		}),
};
