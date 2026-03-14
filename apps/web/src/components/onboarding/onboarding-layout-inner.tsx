"use client";

import { StepIndicator } from "@/components/onboarding/step-indicator";
import { useLayoutGate } from "@/hooks/ui/use-layout-gate";
import { cn } from "@/lib/display/utils";
import { getStepInfo, getStepSequence } from "@/lib/onboarding/step-sequence";
import { useOnboardingStore } from "@/stores/onboarding";

export function OnboardingLayoutInner({ children }: { children: React.ReactNode }) {
	const { ready, session } = useLayoutGate();
	const step = useOnboardingStore((state) => state.step);
	const setStep = useOnboardingStore((state) => state.setStep);

	if (!ready) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	const stepSequence = getStepSequence();
	const { current: currentStep, total: totalSteps } = getStepInfo(step, stepSequence);

	const handleStepClick = (stepNum: number) => {
		const target = stepSequence[stepNum - 1];
		if (target) setStep(target);
	};

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<div className="py-6">
				<StepIndicator
					currentStep={currentStep}
					totalSteps={totalSteps}
					onStepClick={handleStepClick}
				/>
			</div>
			<main className={cn("flex flex-1 items-center justify-center p-6 -mt-6")}>
				{children}
			</main>
		</div>
	);
}
