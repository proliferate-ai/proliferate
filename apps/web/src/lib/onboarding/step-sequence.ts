import type { FlowType, OnboardingStep } from "@/stores/onboarding";

export function getStepSequence(flowType: FlowType, billingEnabled: boolean): OnboardingStep[] {
	if (flowType === "developer") {
		const steps: OnboardingStep[] = ["path", "tools"];
		if (billingEnabled) steps.push("billing");
		steps.push("complete");
		return steps;
	}
	const steps: OnboardingStep[] = ["path", "create-org", "questionnaire", "tools", "invite"];
	if (billingEnabled) steps.push("billing");
	steps.push("complete");
	return steps;
}

export function getStepInfo(
	step: OnboardingStep,
	sequence: OnboardingStep[],
): { current: number; total: number } {
	const index = sequence.indexOf(step);
	return { current: (index >= 0 ? index : 0) + 1, total: sequence.length };
}
