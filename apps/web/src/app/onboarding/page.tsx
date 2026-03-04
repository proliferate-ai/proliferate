"use client";

export const dynamic = "force-dynamic";

import { StepBilling } from "@/components/onboarding/step-billing";
import { StepComplete } from "@/components/onboarding/step-complete";
import { StepCreateOrg } from "@/components/onboarding/step-create-org";
import { StepInviteMembers } from "@/components/onboarding/step-invite-members";
import { StepPathChoice } from "@/components/onboarding/step-path-choice";
import { StepQuestionnaire } from "@/components/onboarding/step-questionnaire";
import { StepToolSelection } from "@/components/onboarding/step-tool-selection";
import { useOnboardingFlow } from "@/hooks/org/use-onboarding-flow";

export default function OnboardingPage() {
	const {
		step,
		billingEnabled,
		isFinishing,
		isQuestionnaireSubmitting,
		isToolsSubmitting,
		isFinishSubmitting,
		finishError,
		onPathSelect,
		onOrgCreated,
		onQuestionnaireComplete,
		onToolsComplete,
		onInviteComplete,
		onBillingComplete,
		onFinish,
	} = useOnboardingFlow();

	if (isFinishing) {
		return null;
	}

	return (
		<div key={step} className="animate-in fade-in duration-300">
			{step === "path" && <StepPathChoice onSelect={onPathSelect} />}
			{step === "create-org" && <StepCreateOrg onComplete={onOrgCreated} />}
			{step === "questionnaire" && (
				<StepQuestionnaire
					onComplete={onQuestionnaireComplete}
					isSubmitting={isQuestionnaireSubmitting}
				/>
			)}
			{step === "tools" && (
				<StepToolSelection onComplete={onToolsComplete} isSubmitting={isToolsSubmitting} />
			)}
			{step === "invite" && <StepInviteMembers onComplete={onInviteComplete} />}
			{step === "billing" && billingEnabled && <StepBilling onComplete={onBillingComplete} />}
			{step === "complete" && (
				<StepComplete onComplete={onFinish} isSubmitting={isFinishSubmitting} error={finishError} />
			)}
		</div>
	);
}
