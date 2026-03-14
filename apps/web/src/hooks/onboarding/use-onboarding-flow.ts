"use client";

import { useOnboardingStore } from "@/stores/onboarding";
import { useRouter } from "next/navigation";

export function useOnboardingFlow() {
	const router = useRouter();

	const step = useOnboardingStore((state) => state.step);
	const setStep = useOnboardingStore((state) => state.setStep);
	const reset = useOnboardingStore((state) => state.reset);

	const handleOrgCreated = () => {
		setStep("invite");
	};

	const handleInviteComplete = () => {
		setStep("complete");
	};

	const handleFinish = () => {
		router.push("/sessions");
		reset();
	};

	return {
		step,
		onOrgCreated: handleOrgCreated,
		onInviteComplete: handleInviteComplete,
		onFinish: handleFinish,
	};
}
