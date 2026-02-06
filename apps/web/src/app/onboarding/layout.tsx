"use client";

import { Button } from "@/components/ui/button";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useOnboardingStore } from "@/stores/onboarding";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

interface OnboardingLayoutProps {
	children: React.ReactNode;
}

function StepIndicator({
	currentStep,
	totalSteps,
	onStepClick,
}: {
	currentStep: number;
	totalSteps: number;
	onStepClick?: (step: number) => void;
}) {
	return (
		<div className="flex items-center justify-center gap-2">
			{Array.from({ length: totalSteps }).map((_, index) => {
				const stepNum = index + 1;
				const isCompleted = stepNum < currentStep;
				const isCurrent = stepNum === currentStep;
				const canClick = isCompleted && onStepClick;

				return (
					<Button
						variant="ghost"
						key={stepNum}
						onClick={() => canClick && onStepClick(stepNum)}
						disabled={!canClick}
						className={cn(
							"h-1.5 p-0 rounded-full transition-all",
							isCompleted || isCurrent ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/30",
							canClick && "cursor-pointer hover:opacity-70",
							!canClick && "cursor-default",
						)}
					/>
				);
			})}
		</div>
	);
}

function OnboardingLayoutInner({ children }: OnboardingLayoutProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending: authPending } = useSession();
	const { data: onboarding, isLoading: onboardingLoading } = useOnboarding();
	const step = useOnboardingStore((state) => state.step);
	const flowType = useOnboardingStore((state) => state.flowType);
	const setStep = useOnboardingStore((state) => state.setStep);

	// Check if we're returning from a successful OAuth flow
	const isReturningFromOAuth =
		searchParams.get("success") === "github" || searchParams.get("success") === "slack";

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Redirect to dashboard if onboarding is already complete (except for repos/payment/complete steps or OAuth return)
	useEffect(() => {
		if (
			!onboardingLoading &&
			onboarding?.hasGitHubConnection &&
			step !== "repos" &&
			step !== "payment" &&
			step !== "complete" &&
			!isReturningFromOAuth
		) {
			router.push("/dashboard");
		}
	}, [onboarding, onboardingLoading, router, step, isReturningFromOAuth]);

	// Wait for both auth AND onboarding to load before rendering anything
	if (authPending || onboardingLoading) {
		return <div className="min-h-screen bg-background dark:bg-neutral-950" />;
	}

	if (!session) {
		return null;
	}

	// Don't render onboarding shell if user is already complete (except for repos/payment/complete steps or OAuth return)
	if (
		onboarding?.hasGitHubConnection &&
		step !== "repos" &&
		step !== "payment" &&
		step !== "complete" &&
		!isReturningFromOAuth
	) {
		return null;
	}

	// Calculate step progress
	const getStepInfo = () => {
		if (flowType === "personal") {
			// Personal: path(1) → github(2) → repos(3) → payment(4) → complete(5)
			const steps = { path: 1, github: 2, repos: 3, payment: 4, complete: 5 };
			return { current: steps[step as keyof typeof steps] || 1, total: 5 };
		}
		// Organization: path(1) → create-org(2) → slack(3) → github(4) → repos(5) → payment(6) → complete(7)
		const steps = {
			path: 1,
			"create-org": 2,
			slack: 3,
			github: 4,
			repos: 5,
			payment: 6,
			complete: 7,
		};
		return { current: steps[step as keyof typeof steps] || 1, total: 7 };
	};

	const handleStepClick = (stepNum: number) => {
		if (flowType === "personal") {
			const stepMap = ["path", "github", "repos", "payment", "complete"] as const;
			setStep(stepMap[stepNum - 1]);
		} else {
			const stepMap = [
				"path",
				"create-org",
				"slack",
				"github",
				"repos",
				"payment",
				"complete",
			] as const;
			setStep(stepMap[stepNum - 1]);
		}
	};

	const { current: currentStep, total: totalSteps } = getStepInfo();
	const isFirstStep = step === "path";

	return (
		<div className="min-h-screen bg-background dark:bg-neutral-950 flex flex-col">
			{/* Step Indicator */}
			{!isFirstStep && (
				<div className="py-6">
					<StepIndicator
						currentStep={currentStep}
						totalSteps={totalSteps}
						onStepClick={handleStepClick}
					/>
				</div>
			)}

			{/* Main content */}
			<main className={cn("flex-1 flex items-center justify-center p-6", !isFirstStep && "-mt-6")}>
				{children}
			</main>
		</div>
	);
}

export default function OnboardingLayout({ children }: OnboardingLayoutProps) {
	return (
		<Suspense fallback={<div className="min-h-screen bg-background dark:bg-neutral-950" />}>
			<OnboardingLayoutInner>{children}</OnboardingLayoutInner>
		</Suspense>
	);
}
