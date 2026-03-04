"use client";

import { useOnboarding } from "@/hooks/org/use-onboarding";
import { orpc } from "@/lib/infra/orpc";
import { type FlowType, useOnboardingStore } from "@/stores/onboarding";
import { env } from "@proliferate/environment/public";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function useOnboardingFlow() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { refetch } = useOnboarding();
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	const flowType = useOnboardingStore((state) => state.flowType);
	const step = useOnboardingStore((state) => state.step);
	const setFlowType = useOnboardingStore((state) => state.setFlowType);
	const setStep = useOnboardingStore((state) => state.setStep);
	const reset = useOnboardingStore((state) => state.reset);

	// Handle billing success callback from Stripe redirect
	useEffect(() => {
		if (searchParams.get("success") === "billing") {
			refetch();
			setStep("complete");
			window.history.replaceState({}, "", "/onboarding");
		}
	}, [searchParams, refetch, setStep]);

	// Skip billing step if billing is disabled
	useEffect(() => {
		if (!billingEnabled && step === "billing") {
			refetch();
			setStep("complete");
		}
	}, [billingEnabled, step, refetch, setStep]);

	const saveToolsMutation = useMutation({
		...orpc.onboarding.saveToolSelections.mutationOptions(),
	});

	const saveQuestionnaireMutation = useMutation({
		...orpc.onboarding.saveQuestionnaire.mutationOptions(),
	});

	const markCompleteMutation = useMutation({
		...orpc.onboarding.markComplete.mutationOptions(),
	});

	const onPathSelect = (type: FlowType) => {
		setFlowType(type);
		setStep(type === "developer" ? "tools" : "create-org");
	};

	const onOrgCreated = () => setStep("questionnaire");

	const onQuestionnaireComplete = (data: {
		referralSource?: string;
		companyWebsite?: string;
		teamSize?: string;
	}) => {
		saveQuestionnaireMutation.mutate(data, {
			onSettled: () => setStep("tools"),
		});
	};

	const onToolsComplete = (selectedTools: string[]) => {
		saveToolsMutation.mutate(
			{ selectedTools },
			{
				onSettled: () => {
					if (flowType === "organization") setStep("invite");
					else if (billingEnabled) setStep("billing");
					else setStep("complete");
				},
			},
		);
	};

	const onInviteComplete = () => {
		setStep(billingEnabled ? "billing" : "complete");
	};

	const onBillingComplete = () => {
		refetch();
		setStep("complete");
	};

	const onFinish = () => {
		markCompleteMutation.mutate(undefined, {
			onSuccess: async () => {
				await refetch();
				// Navigate first to avoid flashing the path choice step during store reset
				router.push("/dashboard");
				reset();
			},
		});
	};

	return {
		step,
		billingEnabled,
		isFinishing: markCompleteMutation.isSuccess,
		isQuestionnaireSubmitting: saveQuestionnaireMutation.isPending,
		isToolsSubmitting: saveToolsMutation.isPending,
		isFinishSubmitting: markCompleteMutation.isPending,
		finishError: markCompleteMutation.error?.message,
		onPathSelect,
		onOrgCreated,
		onQuestionnaireComplete,
		onToolsComplete,
		onInviteComplete,
		onBillingComplete,
		onFinish,
	};
}
