"use client";

import { useAutomations } from "@/hooks/use-automations";
import { useIntegrations } from "@/hooks/use-integrations";
import { useRepos } from "@/hooks/use-repos";
import { useCreateSession } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OnboardingCards } from "./onboarding-cards";
import { PromptInput } from "./prompt-input";
import { WelcomeDialog } from "./welcome-dialog";

export function EmptyDashboard() {
	const router = useRouter();
	const {
		selectedRepoId,
		selectedSnapshotId,
		setActiveSession,
		setPendingPrompt,
		dismissedOnboardingCards,
	} = useDashboardStore();
	const createSession = useCreateSession();

	// Query data to determine if onboarding cards exist (TanStack Query deduplicates)
	const { data: integrationsData, isLoading: intLoading } = useIntegrations();
	const { data: automations, isLoading: autoLoading } = useAutomations();
	const { data: repos, isLoading: reposLoading } = useRepos();

	const dataLoading = intLoading || autoLoading || reposLoading;

	const hasCards = useMemo(() => {
		if (dataLoading) return false;
		const integrations = integrationsData?.integrations ?? [];
		const hasGitHub = integrations.some((i) => i.provider === "github" && i.status === "active");
		const hasSlack = integrations.some((i) => i.provider === "slack" && i.status === "active");
		const hasAutomation = (automations ?? []).length > 0;
		const hasRepoWithSnapshot = (repos ?? []).some((r) => r.prebuildStatus === "ready");

		let count = 0;
		if (!hasRepoWithSnapshot) count++;
		if (!hasGitHub && !dismissedOnboardingCards.includes("github")) count++;
		if (!hasSlack && !dismissedOnboardingCards.includes("slack")) count++;
		if (!hasAutomation && !dismissedOnboardingCards.includes("automation")) count++;
		return count > 0;
	}, [integrationsData, automations, repos, dataLoading, dismissedOnboardingCards]);

	// Animate cards in after data loads
	const [showCards, setShowCards] = useState(false);

	useEffect(() => {
		if (hasCards) {
			// Double-rAF ensures the browser paints the collapsed state first
			const raf = requestAnimationFrame(() => {
				requestAnimationFrame(() => setShowCards(true));
			});
			return () => cancelAnimationFrame(raf);
		}
		setShowCards(false);
	}, [hasCards]);

	const handleSubmit = async (prompt: string) => {
		if (!selectedRepoId || !selectedSnapshotId) return;

		// Store the prompt in dashboard store so it can be passed to CodingSession
		setPendingPrompt(prompt);

		try {
			// Create session with prebuild (selectedSnapshotId is the prebuild ID)
			const result = await createSession.mutateAsync({
				prebuildId: selectedSnapshotId,
			});

			// Set active session and navigate to session page
			setActiveSession(result.sessionId);
			router.push(`/dashboard/sessions/${result.sessionId}`);
		} catch (error) {
			console.error("Failed to create session:", error);
			// Clear pending prompt on error
			setPendingPrompt(null);
		}
	};

	return (
		<div className="h-full flex flex-col items-center p-8 overflow-y-auto">
			<WelcomeDialog />
			<div className="w-full max-w-2xl my-auto">
				<div className="space-y-8">
					{/* Main heading */}
					<div className="text-center">
						<h2 className="text-2xl font-semibold">What do you want to build?</h2>
					</div>

					{/* Prompt input */}
					<PromptInput onSubmit={handleSubmit} isLoading={createSession.isPending} />
				</div>

				{/* Onboarding cards - animated entrance */}
				<div
					className={cn(
						"grid transition-[grid-template-rows,opacity] duration-500 ease-out",
						showCards && hasCards ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
					)}
				>
					<div className="overflow-hidden">
						<div className="pt-8">
							<OnboardingCards />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
