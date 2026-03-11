import { z } from "zod";

export const BillingSettingsSchema = z.object({
	auto_recharge_enabled: z.boolean(),
	overage_cap_cents: z.number().nullable(),
});

export type BillingSettings = z.infer<typeof BillingSettingsSchema>;

export const BillingInfoSchema = z.object({
	plan: z.object({
		id: z.string(),
		name: z.string(),
		monthlyPriceCents: z.number(),
		creditsIncluded: z.number(),
	}),
	selectedPlan: z.enum(["dev", "pro"]),
	hasActiveSubscription: z.boolean(),
	hasPaymentMethod: z.boolean(),
	credits: z.object({
		balance: z.number(),
		used: z.number(),
		included: z.number(),
		nextResetAt: z.string().nullable(),
	}),
	limits: z.object({
		maxConcurrentSessions: z.number(),
		maxSnapshots: z.number(),
		snapshotRetentionDays: z.number(),
	}),
	billingSettings: BillingSettingsSchema,
	state: z.object({
		billingState: z.enum(["free", "active", "grace", "exhausted", "suspended"]),
		shadowBalance: z.number(),
		graceExpiresAt: z.string().nullable(),
		canStartSession: z.boolean(),
		stateMessage: z.string(),
	}),
});

export type BillingInfo = z.infer<typeof BillingInfoSchema>;

export const BuyCreditsResponseSchema = z.object({
	success: z.boolean(),
	checkoutUrl: z.string().optional(),
	credits: z.number(),
	priceCents: z.number().optional(),
	message: z.string().optional(),
});

export type BuyCreditsResponse = z.infer<typeof BuyCreditsResponseSchema>;

export const ActivatePlanResponseSchema = z.object({
	success: z.boolean(),
	checkoutUrl: z.string().optional(),
	message: z.string().optional(),
});

export type ActivatePlanResponse = z.infer<typeof ActivatePlanResponseSchema>;

export const UpdateBillingSettingsResponseSchema = z.object({
	success: z.boolean(),
	settings: BillingSettingsSchema,
});

export const SetupPaymentResponseSchema = z.object({
	success: z.boolean(),
	checkoutUrl: z.string().optional(),
	message: z.string().optional(),
});

export type SetupPaymentResponse = z.infer<typeof SetupPaymentResponseSchema>;

export type UpdateBillingSettingsResponse = z.infer<typeof UpdateBillingSettingsResponseSchema>;
