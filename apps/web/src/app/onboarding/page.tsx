"use client";

export const dynamic = "force-dynamic";

import { StepComplete } from "@/components/onboarding/step-complete";
import { StepCreateOrg } from "@/components/onboarding/step-create-org";
import { StepInviteMembers } from "@/components/onboarding/step-invite-members";
import { useOnboardingFlow } from "@/hooks/onboarding/use-onboarding-flow";

export default function OnboardingPage() {
	const {
		step,
		onOrgCreated,
		onInviteComplete,
		onFinish,
	} = useOnboardingFlow();

	return (
		<div key={step} className="animate-in fade-in duration-300">
			{step === "create-org" && <StepCreateOrg onComplete={onOrgCreated} />}
			{step === "invite" && <StepInviteMembers onComplete={onInviteComplete} />}
			{step === "complete" && <StepComplete onComplete={onFinish} />}
		</div>
	);
}
