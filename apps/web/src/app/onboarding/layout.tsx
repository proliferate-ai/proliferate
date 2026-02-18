"use client";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useOnboardingStore } from "@/stores/onboarding";
import { env } from "@proliferate/environment/public";
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
	const step = useOnboardingStore((state) => state.step);
	const flowType = useOnboardingStore((state) => state.flowType);
	const setStep = useOnboardingStore((state) => state.setStep);
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Wait for auth to load before rendering anything
	if (authPending) {
		return <div className="min-h-screen bg-background dark:bg-neutral-950" />;
	}

	if (!session) {
		return null;
	}

	// Build step sequence based on flow type and billing
	const getStepSequence = (): string[] => {
		if (flowType === "developer") {
			const steps = ["path", "tools"];
			if (billingEnabled) steps.push("billing");
			steps.push("complete");
			return steps;
		}
		const steps = ["path", "create-org", "questionnaire", "tools", "invite"];
		if (billingEnabled) steps.push("billing");
		steps.push("complete");
		return steps;
	};

	const stepSequence = getStepSequence();

	const getStepInfo = () => {
		const index = stepSequence.indexOf(step);
		return { current: (index >= 0 ? index : 0) + 1, total: stepSequence.length };
	};

	const handleStepClick = (stepNum: number) => {
		const target = stepSequence[stepNum - 1];
		if (target) {
			setStep(target as typeof step);
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
