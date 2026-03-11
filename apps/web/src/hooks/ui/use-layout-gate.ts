"use client";

import { useBilling } from "@/hooks/org/use-billing";
import { useOnboarding } from "@/hooks/org/use-onboarding";
import { useRequireAuth } from "@/hooks/ui/use-require-auth";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface LayoutGateOptions {
	requireOnboarding?: boolean;
}

export function useLayoutGate(options: LayoutGateOptions = {}) {
	const { requireOnboarding = false } = options;
	const router = useRouter();
	const { session, isPending: authPending } = useRequireAuth();

	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const { isLoading: billingLoading } = useBilling();
	const { data: onboardingStatus, isLoading: onboardingLoading } = useOnboarding();

	const needsOnboarding =
		requireOnboarding && onboardingStatus ? !onboardingStatus.onboardingComplete : false;

	useEffect(() => {
		if (!authPending && session && !onboardingLoading && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, onboardingLoading, needsOnboarding, router]);

	// Don't include billingError as a gate — transient billing API failures
	// should not permanently block the workspace UI
	const gatesLoading =
		authPending || (requireOnboarding && onboardingLoading) || (billingEnabled && billingLoading);

	const ready = !gatesLoading && !!session && !needsOnboarding;

	return { ready, session, gatesLoading };
}
