"use client";

import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useOnboardingComplete } from "@/hooks/onboarding/use-onboarding-complete";
import { useRouter } from "next/navigation";

/**
 * /onboarding/complete
 *
 * Landing page after Stripe checkout completes.
 * Marks the organization's billing setup as complete and redirects to onboarding.
 */
export default function OnboardingCompletePage() {
	const router = useRouter();
	const { error } = useOnboardingComplete();

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<p className="text-destructive mb-4">{error}</p>
					<Button variant="link" onClick={() => router.push("/onboarding")} className="text-sm">
						Return to onboarding
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex items-center justify-center">
			<div className="text-center">
				<LoadingDots size="lg" />
				<p className="mt-4 text-muted-foreground">Completing setup...</p>
			</div>
		</div>
	);
}
