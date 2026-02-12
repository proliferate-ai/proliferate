"use client";

export const dynamic = "force-dynamic";

import { StepComplete } from "@/components/onboarding/step-complete";
import { StepCreateOrg } from "@/components/onboarding/step-create-org";
import { StepGitHubConnect } from "@/components/onboarding/step-github-connect";
import { StepPathChoice } from "@/components/onboarding/step-path-choice";
import { StepPayment } from "@/components/onboarding/step-payment";
import { StepSlackConnect } from "@/components/onboarding/step-slack-connect";
import { useOnboarding } from "@/hooks/use-onboarding";
import { type FlowType, useOnboardingStore } from "@/stores/onboarding";
import { env } from "@proliferate/environment/public";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function OnboardingPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: onboarding, refetch } = useOnboarding();
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;

	const flowType = useOnboardingStore((state) => state.flowType);
	const step = useOnboardingStore((state) => state.step);
	const setFlowType = useOnboardingStore((state) => state.setFlowType);
	const setStep = useOnboardingStore((state) => state.setStep);
	const reset = useOnboardingStore((state) => state.reset);

	// Track if we just returned from Slack OAuth
	const [justConnectedSlack, setJustConnectedSlack] = useState(
		() =>
			typeof window !== "undefined" &&
			new URLSearchParams(window.location.search).get("success") === "slack",
	);

	// Handle GitHub OAuth callback - repos are auto-added, skip to next step
	useEffect(() => {
		if (searchParams.get("success") === "github") {
			refetch();
			if (billingEnabled) {
				setStep("payment");
			} else {
				setStep("complete");
			}
			window.history.replaceState({}, "", "/onboarding");
		}
	}, [searchParams, refetch, setStep, billingEnabled]);

	// Handle billing success callback - go to complete step
	useEffect(() => {
		if (searchParams.get("success") === "billing") {
			refetch();
			setStep("complete");
			window.history.replaceState({}, "", "/onboarding");
		}
	}, [searchParams, refetch, setStep]);

	// Clean up the URL after reading Slack success
	useEffect(() => {
		if (searchParams.get("success") === "slack") {
			window.history.replaceState({}, "", "/onboarding");
		}
	}, [searchParams]);

	const handlePathSelect = (type: FlowType) => {
		setFlowType(type);

		if (type === "personal") {
			// Personal flow skips org creation, goes directly to GitHub
			setStep("github");
		} else {
			// Organization flow creates a new org first
			setStep("create-org");
		}
	};

	const handleOrgCreated = () => {
		// After creating org, go to Slack step
		setStep("slack");
	};

	const handleSlackConnected = () => {
		setJustConnectedSlack(false);
		refetch();
		setStep("github");
	};

	const handleSkipSlack = () => {
		setStep("github");
	};

	const handleGitHubConnected = () => {
		refetch();
		if (billingEnabled) {
			setStep("payment");
		} else {
			setStep("complete");
		}
	};

	const handleSkipGitHub = () => {
		// Skip GitHub — advance to payment (or complete if billing disabled)
		if (billingEnabled) {
			setStep("payment");
		} else {
			setStep("complete");
		}
	};

	const handlePaymentComplete = () => {
		refetch();
		setStep("complete");
	};

	const handleFinish = () => {
		// Reset onboarding state and go to dashboard
		reset();
		refetch();
		router.push("/dashboard");
	};

	useEffect(() => {
		if (!billingEnabled && step === "payment") {
			refetch();
			setStep("complete");
		}
	}, [billingEnabled, step, refetch, setStep]);

	// Check connection status
	const hasSlackConnection = onboarding?.hasSlackConnection ?? false;
	const hasGitHubConnection = onboarding?.hasGitHubConnection ?? false;

	return (
		<div key={step} className="animate-in fade-in duration-300">
			{step === "path" && <StepPathChoice onSelect={handlePathSelect} />}
			{step === "create-org" && <StepCreateOrg onComplete={handleOrgCreated} />}
			{step === "slack" && (
				<StepSlackConnect
					onConnected={handleSlackConnected}
					onSkip={handleSkipSlack}
					hasSlackConnection={hasSlackConnection}
					justConnected={justConnectedSlack}
				/>
			)}
			{step === "github" && (
				<StepGitHubConnect
					onComplete={handleGitHubConnected}
					onSkip={handleSkipGitHub}
					hasGitHubConnection={hasGitHubConnection}
				/>
			)}
			{step === "payment" && billingEnabled && <StepPayment onComplete={handlePaymentComplete} />}
			{step === "complete" && <StepComplete onComplete={handleFinish} />}
		</div>
	);
}
