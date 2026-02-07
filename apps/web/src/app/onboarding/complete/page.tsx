"use client";

import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { orpc } from "@/lib/orpc";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * /onboarding/complete
 *
 * Landing page after Stripe checkout completes.
 * Marks the organization's billing setup as complete and redirects to onboarding.
 */
export default function OnboardingCompletePage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [error, setError] = useState<string | null>(null);
	const hasStarted = useRef(false);

	const markCompleteMutation = useMutation(orpc.onboarding.markComplete.mutationOptions());

	useEffect(() => {
		if (hasStarted.current) return;
		hasStarted.current = true;

		async function completeSetup() {
			try {
				// Mark onboarding complete
				await markCompleteMutation.mutateAsync({});

				const returnTo = searchParams.get("return");
				if (returnTo) {
					router.replace(returnTo);
				} else {
					// Redirect back to onboarding flow
					router.replace("/onboarding?success=billing");
				}
			} catch (err) {
				console.error("Failed to complete onboarding:", err);
				setError("Failed to complete setup. Please try again.");
			}
		}

		completeSetup();
	}, [router, markCompleteMutation, searchParams]);

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
