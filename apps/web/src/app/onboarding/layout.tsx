"use client";

import { Button } from "@/components/ui/button";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useOnboardingStore } from "@/stores/onboarding";
import { useRouter } from "next/navigation";
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
	const { data: session, isPending: authPending } = useSession();
	const { data: onboarding, isLoading: onboardingLoading } = useOnboarding();
	const step = useOnboardingStore((state) => state.step);
	const flowType = useOnboardingStore((state) => state.flowType);
	const setStep = useOnboardingStore((state) => state.setStep);

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Redirect to dashboard if onboarding is already complete
	useEffect(() => {
		if (!onboardingLoading && onboarding?.onboardingComplete) {
			router.push("/dashboard");
		}
	}, [onboarding, onboardingLoading, router]);

	// Wait for auth to load before rendering anything
	if (authPending) {
		return <div className="min-h-screen bg-background dark:bg-neutral-950" />;
	}

	if (!session) {
		return null;
	}

	// Calculate step progress
	const getStepInfo = () => {
		if (flowType === "personal") {
			// Personal: path(1) → github(2) → payment(3) → complete(4)
			const steps = { path: 1, github: 2, payment: 3, complete: 4 };
			return { current: steps[step as keyof typeof steps] || 1, total: 4 };
		}
		// Organization: path(1) → create-org(2) → slack(3) → github(4) → payment(5) → complete(6)
		const steps = {
			path: 1,
			"create-org": 2,
			slack: 3,
			github: 4,
			payment: 5,
			complete: 6,
		};
		return { current: steps[step as keyof typeof steps] || 1, total: 6 };
	};

	const handleStepClick = (stepNum: number) => {
		if (flowType === "personal") {
			const stepMap = ["path", "github", "payment", "complete"] as const;
			setStep(stepMap[stepNum - 1]);
		} else {
			const stepMap = ["path", "create-org", "slack", "github", "payment", "complete"] as const;
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
