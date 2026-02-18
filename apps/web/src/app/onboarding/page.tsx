"use client";

export const dynamic = "force-dynamic";

import { StepBilling } from "@/components/onboarding/step-billing";
import { StepComplete } from "@/components/onboarding/step-complete";
import { StepCreateOrg } from "@/components/onboarding/step-create-org";
import { StepInviteMembers } from "@/components/onboarding/step-invite-members";
import { StepPathChoice } from "@/components/onboarding/step-path-choice";
import { StepQuestionnaire } from "@/components/onboarding/step-questionnaire";
import { StepToolSelection } from "@/components/onboarding/step-tool-selection";
import { useOnboarding } from "@/hooks/use-onboarding";
import { orpc } from "@/lib/orpc";
import { type FlowType, useOnboardingStore } from "@/stores/onboarding";
import { env } from "@proliferate/environment/public";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function OnboardingPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { refetch } = useOnboarding();
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	const flowType = useOnboardingStore((state) => state.flowType);
	const step = useOnboardingStore((state) => state.step);
	const setFlowType = useOnboardingStore((state) => state.setFlowType);
	const setStep = useOnboardingStore((state) => state.setStep);
	const reset = useOnboardingStore((state) => state.reset);

	// Handle billing success callback - go to complete step
	useEffect(() => {
		if (searchParams.get("success") === "billing") {
			refetch();
			setStep("complete");
			window.history.replaceState({}, "", "/onboarding");
		}
	}, [searchParams, refetch, setStep]);

	// If billing is disabled, skip the billing step
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

	const handlePathSelect = (type: FlowType) => {
		setFlowType(type);

		if (type === "developer") {
			// Developer flow: skip org creation, go to tool selection
			setStep("tools");
		} else {
			// Organization flow: create org first
			setStep("create-org");
		}
	};

	const handleOrgCreated = () => {
		setStep("questionnaire");
	};

	const handleQuestionnaireComplete = (data: {
		referralSource?: string;
		companyWebsite?: string;
		teamSize?: string;
	}) => {
		saveQuestionnaireMutation.mutate(data, {
			onSettled: () => {
				setStep("tools");
			},
		});
	};

	const handleToolsComplete = (selectedTools: string[]) => {
		saveToolsMutation.mutate(
			{ selectedTools },
			{
				onSettled: () => {
					if (flowType === "organization") {
						setStep("invite");
					} else if (billingEnabled) {
						setStep("billing");
					} else {
						setStep("complete");
					}
				},
			},
		);
	};

	const handleInviteComplete = () => {
		if (billingEnabled) {
			setStep("billing");
		} else {
			setStep("complete");
		}
	};

	const handleBillingComplete = () => {
		refetch();
		setStep("complete");
	};

	const handleFinish = () => {
		markCompleteMutation.mutate(undefined, {
			onSuccess: async () => {
				reset();
				await refetch();
				router.push("/dashboard");
			},
			onError: (err) => {
				console.error("Failed to complete onboarding:", err);
			},
		});
	};

	return (
		<div key={step} className="animate-in fade-in duration-300">
			{step === "path" && <StepPathChoice onSelect={handlePathSelect} />}
			{step === "create-org" && <StepCreateOrg onComplete={handleOrgCreated} />}
			{step === "questionnaire" && (
				<StepQuestionnaire
					onComplete={handleQuestionnaireComplete}
					isSubmitting={saveQuestionnaireMutation.isPending}
				/>
			)}
			{step === "tools" && (
				<StepToolSelection
					onComplete={handleToolsComplete}
					isSubmitting={saveToolsMutation.isPending}
				/>
			)}
			{step === "invite" && <StepInviteMembers onComplete={handleInviteComplete} />}
			{step === "billing" && billingEnabled && <StepBilling onComplete={handleBillingComplete} />}
			{step === "complete" && (
				<StepComplete
					onComplete={handleFinish}
					isSubmitting={markCompleteMutation.isPending}
					error={markCompleteMutation.error?.message}
				/>
			)}
		</div>
	);
}
