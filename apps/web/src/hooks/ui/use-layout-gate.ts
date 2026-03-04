"use client";

import { useBilling } from "@/hooks/org/use-billing";
import { useOnboarding } from "@/hooks/org/use-onboarding";
import { useRequireAuth } from "@/hooks/ui/use-require-auth";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface LayoutGateOptions {
	requireOnboarding?: boolean;
	requireBilling?: boolean;
}

export function useLayoutGate(options: LayoutGateOptions = {}) {
	const { requireOnboarding = false, requireBilling = false } = options;
	const router = useRouter();
	const { session, isPending: authPending } = useRequireAuth();

	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const { data: billingInfo, isLoading: billingLoading, isError: billingError } = useBilling();
	const { data: onboardingStatus, isLoading: onboardingLoading } = useOnboarding();

	const needsOnboarding =
		requireOnboarding && onboardingStatus ? !onboardingStatus.onboardingComplete : false;

	const needsBillingSetup =
		requireBilling && billingEnabled && billingInfo?.state.billingState === "unconfigured";

	useEffect(() => {
		if (!authPending && session && !onboardingLoading && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, onboardingLoading, needsOnboarding, router]);

	useEffect(() => {
		if (!authPending && session && !billingLoading && needsBillingSetup) {
			router.push("/onboarding");
		}
	}, [authPending, session, billingLoading, needsBillingSetup, router]);

	const gatesLoading =
		authPending ||
		(requireOnboarding && onboardingLoading) ||
		(billingEnabled && (billingLoading || billingError));

	const ready = !gatesLoading && !!session && !needsOnboarding && !needsBillingSetup;

	return { ready, session, gatesLoading };
}
