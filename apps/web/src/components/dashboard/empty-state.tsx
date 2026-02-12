"use client";

import { useAutomations } from "@/hooks/use-automations";
import { useIntegrations } from "@/hooks/use-integrations";
import { useCreatePrebuild } from "@/hooks/use-prebuilds";
import { useRepos } from "@/hooks/use-repos";
import { useCreateSession } from "@/hooks/use-sessions";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { Github, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OnboardingCards } from "./onboarding-cards";
import { PromptInput } from "./prompt-input";
import { WelcomeDialog } from "./welcome-dialog";

function getGreeting(name: string): string {
	const hour = new Date().getHours();
	if (hour < 12) return `Good morning, ${name}`;
	if (hour < 18) return `Good afternoon, ${name}`;
	return `Good evening, ${name}`;
}

export function EmptyDashboard() {
	const router = useRouter();
	const { data: authSession } = useSession();
	const {
		selectedRepoId,
		selectedSnapshotId,
		selectedModel,
		setActiveSession,
		setPendingPrompt,
		dismissedOnboardingCards,
	} = useDashboardStore();
	const createPrebuild = useCreatePrebuild();
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
		const hasAnyRepo = (repos ?? []).length > 0;
		const hasReadyRepo = (repos ?? []).some((r) => r.prebuildStatus === "ready");

		let count = 0;
		if (!hasAnyRepo) count++;
		else if (!hasReadyRepo) count++; // "Set up your first repo" card
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

	const firstName = authSession?.user?.name?.split(" ")[0] ?? "";
	const greeting = firstName ? getGreeting(firstName) : "How can I help you today?";

	const handleSubmit = async (prompt: string) => {
		// Store the prompt in dashboard store so it can be passed to CodingSession
		setPendingPrompt(prompt);

		try {
			// Scratch session: no repo or snapshot selected
			if (!selectedSnapshotId && !selectedRepoId) {
				const result = await createSession.mutateAsync({
					modelId: selectedModel,
				});
				setActiveSession(result.sessionId);
				router.push(`/dashboard/sessions/${result.sessionId}`);
				return;
			}

			let prebuildId = selectedSnapshotId;

			// If no prebuild selected, create one on-the-fly for the selected repo
			if (!prebuildId && selectedRepoId) {
				const prebuildResult = await createPrebuild.mutateAsync({
					repoIds: [selectedRepoId],
				});
				prebuildId = prebuildResult.prebuildId;
			}

			if (!prebuildId) return;

			// Create session with prebuild
			const result = await createSession.mutateAsync({
				prebuildId,
				modelId: selectedModel,
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

	const isSubmitting = createPrebuild.isPending || createSession.isPending;

	// GitHub nudge: show when no GitHub is connected and not dismissed
	const hasGitHub = useMemo(() => {
		const integrations = integrationsData?.integrations ?? [];
		return integrations.some((i) => i.provider === "github" && i.status === "active");
	}, [integrationsData]);
	const showGitHubNudge =
		!dataLoading && !hasGitHub && !dismissedOnboardingCards.includes("github-nudge");

	return (
		<div className="h-full flex flex-col items-center justify-center p-8">
			<WelcomeDialog />

			{/* Centered content */}
			<div className="flex flex-col items-center w-full max-w-2xl">
				{/* Personalized greeting */}
				<h2 className="text-3xl font-semibold mb-8">{greeting}</h2>

				{/* Prompt input */}
				<div className="w-full">
					<PromptInput onSubmit={handleSubmit} isLoading={isSubmitting} />
				</div>

				{/* GitHub nudge */}
				{showGitHubNudge && (
					<div className="w-full mt-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
						<Github className="h-3.5 w-3.5 shrink-0" />
						<span>
							<Link href="/dashboard/integrations" className="underline hover:text-foreground">
								Connect GitHub
							</Link>{" "}
							to work on your repos
						</span>
						<button
							type="button"
							className="ml-auto shrink-0 hover:text-foreground"
							onClick={() => useDashboardStore.getState().dismissOnboardingCard("github-nudge")}
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				)}

				{/* Onboarding cards - animated entrance */}
				<div
					className={cn(
						"w-full grid transition-[grid-template-rows,opacity] duration-500 ease-out mt-4",
						showCards && hasCards ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
					)}
				>
					<div className="overflow-hidden">
						<div className="pt-4">
							<OnboardingCards />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
