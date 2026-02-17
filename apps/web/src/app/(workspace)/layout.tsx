"use client";

import { useBilling } from "@/hooks/use-billing";
import { useSession } from "@/lib/auth-client";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspaceLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const { data: session, isPending: authPending } = useSession();
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const { data: billingInfo, isLoading: billingLoading, isError: billingError } = useBilling();
	const needsOnboarding = billingEnabled && billingInfo?.state.billingState === "unconfigured";

	const requireEmailVerification = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Redirect to verify-email if email not verified (when verification is required)
	useEffect(() => {
		if (!authPending && session && requireEmailVerification && !session.user?.emailVerified) {
			router.push("/auth/verify-email");
		}
	}, [session, authPending, router, requireEmailVerification]);

	useEffect(() => {
		if (!authPending && session && !billingLoading && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, billingLoading, needsOnboarding, router]);

	if (authPending || (billingEnabled && (billingLoading || billingError))) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	if (needsOnboarding) {
		return null;
	}

	return <>{children}</>;
}
