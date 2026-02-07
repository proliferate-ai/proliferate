"use client";

import { OnboardingCard } from "@/components/dashboard/onboarding-card";
import { RepoSelector } from "@/components/dashboard/repo-selector";
import { BoltIcon, GithubIcon, SlackIcon } from "@/components/ui/icons";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import { useIntegrations } from "@/hooks/use-integrations";
import {
	type NangoProvider,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import { useRepos } from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { useDashboardStore } from "@/stores/dashboard";
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { FolderGit } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingCards() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [repoSelectorOpen, setRepoSelectorOpen] = useState(false);
	const { dismissedOnboardingCards, dismissOnboardingCard } = useDashboardStore();

	// GitHub connect hooks - use "auth" flow for direct OAuth popup (no extra click)
	const invalidateIntegrations = () => {
		queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		queryClient.invalidateQueries({ queryKey: orpc.onboarding.getStatus.key() });
	};
	const { connect: nangoConnect, loadingProvider: nangoLoadingProvider } = useNangoConnect({
		flow: "auth",
		onSuccess: invalidateIntegrations,
	});
	const { connect: githubAppConnect, isLoading: githubAppLoading } = useGitHubAppConnect({
		onSuccess: invalidateIntegrations,
	});
	const connectGitHub = () => {
		if (shouldUseNangoForProvider("github")) {
			nangoConnect("github" as NangoProvider);
		} else {
			githubAppConnect();
		}
	};
	const githubConnecting = githubAppLoading || (nangoLoadingProvider as string) === "github";

	// Fetch all required data using oRPC hooks
	const { data: integrationsData, isLoading: integrationsLoading } = useIntegrations();
	const { data: automations, isLoading: automationsLoading } = useAutomations();
	const { data: repos, isLoading: reposLoading } = useRepos();

	// Create automation mutation
	const createAutomationMutation = useCreateAutomation();

	const isLoading = integrationsLoading || automationsLoading || reposLoading;
	if (isLoading) return null;

	const integrations = integrationsData?.integrations ?? [];

	// Determine which cards to show
	const hasGitHub = integrations.some((i) => i.provider === "github" && i.status === "active");
	const hasSlack = integrations.some((i) => i.provider === "slack" && i.status === "active");
	const hasAutomation = (automations ?? []).length > 0;
	const hasRepoWithSnapshot = (repos ?? []).some((r) => r.prebuildStatus === "ready");

	// Build cards array based on what's needed
	const cards: React.ReactNode[] = [];

	// Setup first repo card
	if (!hasRepoWithSnapshot) {
		cards.push(
			<Popover.Root key="setup" open={repoSelectorOpen} onOpenChange={setRepoSelectorOpen}>
				<Popover.Trigger asChild>
					<div>
						<OnboardingCard
							icon={<FolderGit className="h-6 w-6" />}
							title="Set up your first repo"
							description="Create a cloud environment with all dependencies ready."
							ctaLabel="Get Started"
							onCtaClick={() => setRepoSelectorOpen(true)}
							image="/onboarding/setup.png"
						/>
					</div>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						className="z-50 p-3 rounded-xl border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95"
						sideOffset={8}
						align="start"
					>
						<p className="text-sm font-medium mb-2">Select a repository</p>
						<RepoSelector
							value={null}
							onValueChange={(repoId) => {
								setRepoSelectorOpen(false);
								router.push(`/dashboard/sessions/new?repoId=${repoId}&type=setup`);
							}}
							triggerClassName="w-56"
							placeholder="Choose repo..."
						/>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>,
		);
	}

	// TODO: Re-enable demo card once public snapshot support is ready
	// cards.push(
	// 	<OnboardingCard
	// 		key="demo"
	// 		icon={<Play className="h-6 w-6" />}
	// 		title="Try a demo"
	// 		description="Explore with a pre-configured project."
	// 		ctaLabel="Launch Demo"
	// 		onCtaClick={() => {}}
	// 		image="/onboarding/demo.png"
	// 	/>,
	// );

	// Link GitHub card
	if (!hasGitHub && !dismissedOnboardingCards.includes("github")) {
		cards.push(
			<OnboardingCard
				key="github"
				icon={<GithubIcon className="h-6 w-6" />}
				title="Link your GitHub"
				description="PRs will be authored by you, not a bot."
				ctaLabel="Connect"
				onCtaClick={connectGitHub}
				isLoading={githubConnecting}
				onDismiss={() => dismissOnboardingCard("github")}
				gradient="github"
			/>,
		);
	}

	// Link Slack card
	if (!hasSlack && !dismissedOnboardingCards.includes("slack")) {
		cards.push(
			<OnboardingCard
				key="slack"
				icon={<SlackIcon className="h-6 w-6" />}
				title="Link your Slack"
				description="Get notifications and trigger automations."
				ctaLabel="Connect"
				onCtaClick={() => router.push("/dashboard/integrations")}
				onDismiss={() => dismissOnboardingCard("slack")}
				gradient="slack"
			/>,
		);
	}

	// Create automation card
	if (!hasAutomation && !dismissedOnboardingCards.includes("automation")) {
		cards.push(
			<OnboardingCard
				key="automation"
				icon={<BoltIcon className="h-6 w-6" />}
				title="Create an automation"
				description="Run tasks on events like issues or messages."
				ctaLabel="Create"
				onCtaClick={async () => {
					const automation = await createAutomationMutation.mutateAsync({});
					router.push(`/dashboard/automations/${automation.id}`);
				}}
				isLoading={createAutomationMutation.isPending}
				onDismiss={() => dismissOnboardingCard("automation")}
				image="/onboarding/build.png"
				gradient="automation"
			/>,
		);
	}

	// Don't render if no cards to show
	if (cards.length === 0) return null;

	return (
		<div className="mb-6" data-onboarding-cards>
			{/* Header */}
			<h2 className="text-sm font-medium text-muted-foreground mb-3">Get Started</h2>

			{/* Cards with fade edges that extend beyond max-width */}
			<div className="relative -mx-8">
				<div className="flex gap-3 overflow-x-auto pb-2 px-8 no-scrollbar">{cards}</div>
				{/* Left fade - only in the negative margin area */}
				<div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
				{/* Right fade - only in the negative margin area */}
				<div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
			</div>
		</div>
	);
}
