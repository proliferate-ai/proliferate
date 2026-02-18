"use client";

import { OnboardingCard } from "@/components/dashboard/onboarding-card";
import { RepoSelector } from "@/components/dashboard/repo-selector";
import {
	BoltIcon,
	GithubIcon,
	LinearIcon,
	PostHogIcon,
	SentryIcon,
	SlackIcon,
} from "@/components/ui/icons";
import { useAutomations, useCreateAutomation } from "@/hooks/use-automations";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import { useIntegrations } from "@/hooks/use-integrations";
import {
	type NangoProvider,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useRepos } from "@/hooks/use-repos";
import { orpc } from "@/lib/orpc";
import { useDashboardStore } from "@/stores/dashboard";
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { FolderGit } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingCards({ hideHeader }: { hideHeader?: boolean } = {}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [repoSelectorOpen, setRepoSelectorOpen] = useState(false);
	const { dismissedOnboardingCards, dismissOnboardingCard } = useDashboardStore();

	// Get selected tools from onboarding
	const { data: onboardingData } = useOnboarding();
	const selectedTools = onboardingData?.selectedTools;

	// Helper: should we show a card for this tool?
	// If selectedTools is set, only show cards for tools the user selected.
	// If not set (legacy users), show all.
	const shouldShowTool = (toolId: string) => {
		if (!selectedTools || selectedTools.length === 0) return true;
		return selectedTools.includes(toolId);
	};

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
	const hasGitHub = integrations.some(
		(i) => (i.provider === "github" || i.provider === "github-app") && i.status === "active",
	);
	const hasSlack = integrations.some((i) => i.provider === "slack" && i.status === "active");
	const hasLinear = integrations.some((i) => i.provider === "linear" && i.status === "active");
	const hasSentry = integrations.some((i) => i.provider === "sentry" && i.status === "active");
	const hasPostHog = integrations.some((i) => i.provider === "posthog" && i.status === "active");
	const hasAutomation = (automations ?? []).length > 0;
	const hasAnyRepo = (repos ?? []).length > 0;

	// Build cards array based on what's needed
	const cards: React.ReactNode[] = [];

	if (!hasAnyRepo) {
		// No repos at all — prompt to connect first repo
		cards.push(
			<Popover.Root key="setup" open={repoSelectorOpen} onOpenChange={setRepoSelectorOpen}>
				<Popover.Trigger asChild>
					<div>
						<OnboardingCard
							icon={<FolderGit className="h-6 w-6" />}
							title="Connect your first repo"
							description="Add a repository so agents can start coding in your codebase."
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
								router.push(`/workspace/new?repoId=${repoId}&type=setup`);
							}}
							triggerClassName="w-56"
							placeholder="Choose repo..."
						/>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>,
		);
	}

	// Link GitHub card (only if user selected this tool)
	if (shouldShowTool("github") && !hasGitHub && !dismissedOnboardingCards.includes("github")) {
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
	if (shouldShowTool("slack") && !hasSlack && !dismissedOnboardingCards.includes("slack")) {
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

	// Link Linear card
	if (shouldShowTool("linear") && !hasLinear && !dismissedOnboardingCards.includes("linear")) {
		cards.push(
			<OnboardingCard
				key="linear"
				icon={<LinearIcon className="h-6 w-6" />}
				title="Connect Linear"
				description="Trigger automations from Linear issues."
				ctaLabel="Connect"
				onCtaClick={() => router.push("/dashboard/integrations")}
				onDismiss={() => dismissOnboardingCard("linear")}
			/>,
		);
	}

	// Link Sentry card
	if (shouldShowTool("sentry") && !hasSentry && !dismissedOnboardingCards.includes("sentry")) {
		cards.push(
			<OnboardingCard
				key="sentry"
				icon={<SentryIcon className="h-6 w-6" />}
				title="Connect Sentry"
				description="Auto-fix errors detected by Sentry."
				ctaLabel="Connect"
				onCtaClick={() => router.push("/dashboard/integrations")}
				onDismiss={() => dismissOnboardingCard("sentry")}
			/>,
		);
	}

	// Link PostHog card
	if (shouldShowTool("posthog") && !hasPostHog && !dismissedOnboardingCards.includes("posthog")) {
		cards.push(
			<OnboardingCard
				key="posthog"
				icon={<PostHogIcon className="h-6 w-6" />}
				title="Connect PostHog"
				description="Trigger automations from product analytics."
				ctaLabel="Connect"
				onCtaClick={() => router.push("/dashboard/integrations")}
				onDismiss={() => dismissOnboardingCard("posthog")}
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

	// When hideHeader is true, render bare cards (parent manages scrolling/layout)
	if (hideHeader) {
		return <>{cards}</>;
	}

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
