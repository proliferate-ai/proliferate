import type { OnboardingStep } from "@/stores/onboarding";

export function getStepSequence(): OnboardingStep[] {
	return ["create-org", "invite", "complete"];
}

export function getStepInfo(
	step: OnboardingStep,
	sequence: OnboardingStep[],
): { current: number; total: number } {
	const index = sequence.indexOf(step);
	return { current: (index >= 0 ? index : 0) + 1, total: sequence.length };
}
