"use client";

import { orpc } from "@/lib/infra/orpc";
import { env } from "@proliferate/environment/public";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Hook to fetch billing information for the current organization.
 * Includes plan details, credit balances, limits, and settings.
 */
export function useBilling() {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	return useQuery({
		...orpc.billing.getInfo.queryOptions({ input: {} }),
		enabled: billingEnabled,
		staleTime: 30_000,
		refetchInterval: 30_000,
	});
}

/**
 * Billing state types.
 */
export type BillingStateType = "free" | "active" | "grace" | "exhausted" | "suspended";

/**
 * Derived billing state for common checks.
 */
export interface BillingState {
	isLoaded: boolean;
	hasCredits: boolean;
	creditBalance: number;
	planName: string;
	isFreeState: boolean;
	selectedPlan: "dev" | "pro";
	hasActiveSubscription: boolean;
	isNearCreditLimit: boolean;
	autoRechargeEnabled: boolean;
	billingState: BillingStateType;
	shadowBalance: number;
	graceExpiresAt: string | null;
	canStartSession: boolean;
	stateMessage: string;
}

/**
 * Hook to get simplified billing state for UI components.
 */
export function useBillingState(): BillingState {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const { data, isLoading, isError } = useBilling();

	if (!billingEnabled || isLoading || isError || !data) {
		return {
			isLoaded: false,
			hasCredits: true, // Default to allowing access while loading
			creditBalance: 0,
			planName: "Loading...",
			isFreeState: true,
			selectedPlan: "dev",
			hasActiveSubscription: false,
			isNearCreditLimit: false,
			autoRechargeEnabled: false,
			billingState: "free",
			shadowBalance: 0,
			graceExpiresAt: null,
			canStartSession: true,
			stateMessage: "Loading billing status...",
		};
	}

	const creditBalance = data.credits.balance;
	const hasCredits = creditBalance > 0;
	const isFreeState = data.state.billingState === "free";
	// Consider "near limit" when below 2% of included credits or < 1 credit
	const isNearCreditLimit = creditBalance < Math.max(data.credits.included * 0.02, 1);

	return {
		isLoaded: true,
		hasCredits,
		creditBalance,
		planName: data.plan.name,
		isFreeState,
		selectedPlan: data.selectedPlan,
		hasActiveSubscription: data.hasActiveSubscription,
		isNearCreditLimit,
		autoRechargeEnabled: data.billingSettings.auto_recharge_enabled,
		billingState: data.state.billingState,
		shadowBalance: data.state.shadowBalance,
		graceExpiresAt: data.state.graceExpiresAt,
		canStartSession: data.state.canStartSession,
		stateMessage: data.state.stateMessage,
	};
}

/**
 * Hook to purchase additional credits.
 * Returns a checkout URL or confirms credits added directly.
 */
export function useBuyCredits() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.billing.buyCredits.mutationOptions(),
		onSuccess: () => {
			// Invalidate billing data to refresh credit balance
			queryClient.invalidateQueries({ queryKey: orpc.billing.getInfo.key() });
			queryClient.invalidateQueries({ queryKey: orpc.billing.getUsageSummary.key() });
		},
	});
}

/**
 * Hook to update billing settings (auto-recharge, cap, etc.).
 * Only admins/owners can update settings.
 */
export function useUpdateBillingSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.billing.updateSettings.mutationOptions(),
		onSuccess: () => {
			// Invalidate billing data to refresh settings
			queryClient.invalidateQueries({ queryKey: orpc.billing.getInfo.key() });
			queryClient.invalidateQueries({ queryKey: orpc.billing.getUsageSummary.key() });
		},
	});
}

/**
 * Hook to set up a payment method (add credit card).
 */
export function useSetupPaymentMethod() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.billing.setupPaymentMethod.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.billing.getInfo.key() });
		},
	});
}

/**
 * Hook to activate the selected plan.
 */
export function useActivatePlan() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.billing.activatePlan.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.billing.getInfo.key() });
			queryClient.invalidateQueries({ queryKey: orpc.billing.getUsageSummary.key() });
		},
	});
}

/**
 * Hook to fetch usage summary for the current billing period.
 */
export function useUsageSummary() {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	return useQuery({
		...orpc.billing.getUsageSummary.queryOptions({ input: {} }),
		enabled: billingEnabled,
		staleTime: 2 * 60 * 1000,
	});
}

/**
 * Hook to fetch top cost drivers for the current billing period.
 */
export function useCostDrivers(limit = 10) {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	return useQuery({
		...orpc.billing.getCostDrivers.queryOptions({ input: { limit } }),
		enabled: billingEnabled,
		staleTime: 2 * 60 * 1000,
	});
}

/**
 * Hook to fetch recent billing events with pagination.
 */
export function useRecentEvents(limit = 20, offset = 0) {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	return useQuery({
		...orpc.billing.getRecentEvents.queryOptions({ input: { limit, offset } }),
		enabled: billingEnabled,
		staleTime: 2 * 60 * 1000,
	});
}

/**
 * Hook to fetch entitlement status (usage vs plan limits).
 */
export function useEntitlementStatus() {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	return useQuery({
		...orpc.billing.getEntitlementStatus.queryOptions({ input: {} }),
		enabled: billingEnabled,
		staleTime: 60 * 1000,
	});
}
