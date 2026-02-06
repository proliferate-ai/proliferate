"use client";

import { orpc } from "@/lib/orpc";
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
		// Refetch every 5 minutes to keep credit balance fresh
		staleTime: 5 * 60 * 1000,
		// Don't refetch on window focus for billing data
		refetchOnWindowFocus: false,
	});
}

/**
 * Billing state types (V2).
 */
export type BillingStateType =
	| "unconfigured"
	| "trial"
	| "active"
	| "grace"
	| "exhausted"
	| "suspended";

/**
 * Derived billing state for common checks.
 */
export interface BillingState {
	isLoaded: boolean;
	hasCredits: boolean;
	creditBalance: number;
	planName: string;
	isTrialState: boolean;
	selectedPlan: "dev" | "pro";
	hasActiveSubscription: boolean;
	isNearCreditLimit: boolean;
	overagePolicy: "pause" | "allow";
	// V2 state fields
	billingState: BillingStateType;
	shadowBalance: number;
	graceExpiresAt: string | null;
	canStartSession: boolean;
	stateMessage: string;
}

/**
 * Hook to get simplified billing state for UI components.
 * V2: Includes billing state machine info.
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
			isTrialState: false,
			selectedPlan: "dev",
			hasActiveSubscription: false,
			isNearCreditLimit: false,
			overagePolicy: "pause",
			// V2 defaults
			billingState: "unconfigured",
			shadowBalance: 0,
			graceExpiresAt: null,
			canStartSession: true,
			stateMessage: "Loading billing status...",
		};
	}

	const creditBalance = Math.round(data.credits.balance);
	const hasCredits = creditBalance > 0;
	const isTrialState = data.state.billingState === "trial";
	// Consider "near limit" when below 2% of included credits or < 20 credits
	const isNearCreditLimit = creditBalance < Math.max(data.credits.included * 0.02, 20);

	return {
		isLoaded: true,
		hasCredits,
		creditBalance,
		planName: data.plan.name,
		isTrialState,
		selectedPlan: data.selectedPlan,
		hasActiveSubscription: data.hasActiveSubscription,
		isNearCreditLimit,
		overagePolicy: data.billingSettings.overage_policy,
		// V2 state fields
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
			queryClient.invalidateQueries({ queryKey: ["billing"] });
		},
	});
}

/**
 * Hook to update billing settings (overage policy, cap, etc.).
 * Only admins/owners can update settings.
 */
export function useUpdateBillingSettings() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.billing.updateSettings.mutationOptions(),
		onSuccess: () => {
			// Invalidate billing data to refresh settings
			queryClient.invalidateQueries({ queryKey: ["billing"] });
		},
	});
}

/**
 * Hook to activate the selected plan after trial.
 */
export function useActivatePlan() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.billing.activatePlan.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["billing"] });
		},
	});
}
