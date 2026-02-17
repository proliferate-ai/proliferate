"use client";

import { SessionListRow } from "@/components/sessions/session-card";
import { useAutomations } from "@/hooks/use-automations";
import { useOrgPendingRuns } from "@/hooks/use-automations";
import { useIntegrations } from "@/hooks/use-integrations";
import { useCreatePrebuild } from "@/hooks/use-prebuilds";
import { useRepos } from "@/hooks/use-repos";
import { useCreateSession, useSessions } from "@/hooks/use-sessions";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { PendingRunSummary } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OnboardingCards } from "./onboarding-cards";
import { PromptInput } from "./prompt-input";

// ============================================
// Helpers
// ============================================

function getGreeting(name: string): string {
	const hour = new Date().getHours();
	if (hour < 12) return `Good morning, ${name}`;
	if (hour < 18) return `Good afternoon, ${name}`;
	return `Good evening, ${name}`;
}

function getRunStatusLabel(status: PendingRunSummary["status"]): string {
	switch (status) {
		case "needs_human":
			return "Needs help";
		case "failed":
			return "Failed";
		case "timed_out":
			return "Timed out";
		default:
			return status;
	}
}

// ============================================
// Section Header (Tembo-style)
// ============================================

function SectionHeader({
	title,
	subtitle,
	actionLabel,
	actionHref,
	trailing,
}: {
	title: string;
	subtitle?: string;
	actionLabel?: string;
	actionHref?: string;
	trailing?: React.ReactNode;
}) {
	return (
		<div className="flex items-end justify-between mb-3">
			<div>
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
				{subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
			</div>
			{trailing}
			{actionLabel && actionHref && (
				<Link
					href={actionHref}
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
				>
					{actionLabel}
					<ArrowRight className="h-3.5 w-3.5" />
				</Link>
			)}
		</div>
	);
}

// ============================================
// Scrollable Onboarding Cards (Tembo-style nav arrows)
// ============================================

function OnboardingSection() {
	const { dismissedOnboardingCards } = useDashboardStore();
	const { data: integrationsData, isLoading: intLoading } = useIntegrations();
	const { data: automations, isLoading: autoLoading } = useAutomations();
	const { data: repos, isLoading: reposLoading } = useRepos();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [canScrollLeft, setCanScrollLeft] = useState(false);
	const [canScrollRight, setCanScrollRight] = useState(false);

	const dataLoading = intLoading || autoLoading || reposLoading;

	const hasCards = useMemo(() => {
		if (dataLoading) return false;
		const integrations = integrationsData?.integrations ?? [];
		const hasGitHub = integrations.some(
			(i) => (i.provider === "github" || i.provider === "github-app") && i.status === "active",
		);
		const hasSlack = integrations.some((i) => i.provider === "slack" && i.status === "active");
		const hasAutomation = (automations ?? []).length > 0;
		const hasAnyRepo = (repos ?? []).length > 0;
		const hasReadyRepo = (repos ?? []).some((r) => r.prebuildStatus === "ready");

		let count = 0;
		if (!hasAnyRepo) count++;
		else if (!hasReadyRepo) count++;
		if (!hasGitHub && !dismissedOnboardingCards.includes("github")) count++;
		if (!hasSlack && !dismissedOnboardingCards.includes("slack")) count++;
		if (!hasAutomation && !dismissedOnboardingCards.includes("automation")) count++;
		return count > 0;
	}, [integrationsData, automations, repos, dataLoading, dismissedOnboardingCards]);

	const updateScrollState = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setCanScrollLeft(el.scrollLeft > 0);
		setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		updateScrollState();
		el.addEventListener("scroll", updateScrollState, { passive: true });
		const observer = new ResizeObserver(updateScrollState);
		observer.observe(el);
		return () => {
			el.removeEventListener("scroll", updateScrollState);
			observer.disconnect();
		};
	}, [updateScrollState]);

	const scroll = (direction: "left" | "right") => {
		const el = scrollRef.current;
		if (!el) return;
		const distance = 240;
		el.scrollBy({ left: direction === "left" ? -distance : distance, behavior: "smooth" });
	};

	// Animate cards in after data loads
	const [showCards, setShowCards] = useState(false);
	useEffect(() => {
		if (hasCards) {
			const raf = requestAnimationFrame(() => {
				requestAnimationFrame(() => setShowCards(true));
			});
			return () => cancelAnimationFrame(raf);
		}
		setShowCards(false);
	}, [hasCards]);

	if (!hasCards) return null;

	return (
		<div
			className={cn(
				"w-full transition-[opacity] duration-500 ease-out",
				showCards ? "opacity-100" : "opacity-0",
			)}
		>
			<SectionHeader
				title="Get Started"
				subtitle="Complete your setup to get the most out of Proliferate"
				trailing={
					<div className="flex gap-1.5 shrink-0">
						<button
							type="button"
							onClick={() => scroll("left")}
							disabled={!canScrollLeft}
							className={cn(
								"flex items-center justify-center w-7 h-7 rounded-lg bg-muted transition-colors",
								canScrollLeft
									? "hover:bg-accent text-foreground"
									: "text-muted-foreground/40 cursor-default",
							)}
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => scroll("right")}
							disabled={!canScrollRight}
							className={cn(
								"flex items-center justify-center w-7 h-7 rounded-lg bg-muted transition-colors",
								canScrollRight
									? "hover:bg-accent text-foreground"
									: "text-muted-foreground/40 cursor-default",
							)}
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				}
			/>
			<div className="relative">
				<div ref={scrollRef} className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
					<OnboardingCards hideHeader />
				</div>
				{/* Right fade */}
				{canScrollRight && (
					<div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent" />
				)}
			</div>
		</div>
	);
}

// ============================================
// Needs Attention (Triage)
// ============================================

function NeedsAttention() {
	const { data: pendingRuns, isLoading } = useOrgPendingRuns({ limit: 5 });

	if (isLoading || !pendingRuns || pendingRuns.length === 0) return null;

	return (
		<div className="w-full">
			<SectionHeader
				title="Needs Attention"
				subtitle="Agent runs requiring your input"
				actionLabel="Inbox"
				actionHref="/dashboard/inbox"
			/>
			<div className="rounded-xl border border-border overflow-hidden">
				{pendingRuns.map((run) => {
					const timeAgo = run.completed_at
						? formatDistanceToNow(new Date(run.completed_at), { addSuffix: true })
						: formatDistanceToNow(new Date(run.queued_at), { addSuffix: true });

					return (
						<Link
							key={run.id}
							href={
								run.session_id ? `/workspace/${run.session_id}` : `/dashboard/inbox?id=${run.id}`
							}
							className="group flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-sm border-b border-border/50 last:border-0"
						>
							<div className="flex items-center gap-3 min-w-0">
								<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
								<div className="min-w-0">
									<span className="truncate font-medium text-foreground block group-hover:text-primary transition-colors">
										{run.automation_name}
									</span>
									<span className="text-xs text-muted-foreground">
										{run.status_reason || run.error_message
											? (run.status_reason || run.error_message || "").slice(0, 80)
											: timeAgo}
									</span>
								</div>
							</div>
							<span
								className={cn(
									"text-xs shrink-0 ml-3 px-2 py-0.5 rounded-full border",
									run.status === "needs_human"
										? "border-amber-500/30 text-amber-600"
										: "border-destructive/30 text-destructive",
								)}
							>
								{getRunStatusLabel(run.status)}
							</span>
						</Link>
					);
				})}
			</div>
		</div>
	);
}

// ============================================
// Recent Activity (unified sessions list)
// ============================================

function RecentActivity() {
	const { data: sessions, isLoading } = useSessions({
		limit: 5,
		excludeSetup: true,
		excludeCli: true,
	});

	if (isLoading || !sessions || sessions.length === 0) return null;

	return (
		<div className="w-full">
			<SectionHeader
				title="Recent Activity"
				subtitle="Pick up where you left off"
				actionLabel="All Sessions"
				actionHref="/dashboard/sessions"
			/>
			<div className="rounded-lg border border-border bg-card overflow-hidden">
				{sessions.map((session) => (
					<SessionListRow key={session.id} session={session} />
				))}
			</div>
		</div>
	);
}

// ============================================
// Main Component
// ============================================

export function EmptyDashboard() {
	const { data: authSession } = useSession();
	const { selectedRepoId, selectedSnapshotId, selectedModel, setPendingPrompt } =
		useDashboardStore();
	const createPrebuild = useCreatePrebuild();
	const createSession = useCreateSession();

	const firstName = authSession?.user?.name?.split(" ")[0] ?? "";
	const greeting = firstName ? getGreeting(firstName) : "How can I help you today?";

	const handleSubmit = async (prompt: string) => {
		setPendingPrompt(prompt);

		try {
			if (!selectedSnapshotId && !selectedRepoId) {
				await createSession.mutateAsync({
					modelId: selectedModel,
				});
				// Session created — list auto-refreshes via query invalidation
				setPendingPrompt(null);
				return;
			}

			let prebuildId = selectedSnapshotId;

			if (!prebuildId && selectedRepoId) {
				const prebuildResult = await createPrebuild.mutateAsync({
					repoIds: [selectedRepoId],
				});
				prebuildId = prebuildResult.prebuildId;
			}

			if (!prebuildId) return;

			await createSession.mutateAsync({
				prebuildId,
				modelId: selectedModel,
			});
			// Session created — list auto-refreshes via query invalidation
			setPendingPrompt(null);
		} catch (error) {
			console.error("Failed to create session:", error);
			setPendingPrompt(null);
		}
	};

	const isSubmitting = createPrebuild.isPending || createSession.isPending;

	return (
		<div className="h-full flex flex-col overflow-y-auto">
			{/* Prompt input area — full width, pinned at top */}
			<div className="flex flex-col items-center px-4 pt-8 md:pt-16 pb-6">
				<h2 className="text-3xl font-semibold mb-6">{greeting}</h2>
				<div className="w-full max-w-2xl">
					<PromptInput onSubmit={handleSubmit} isLoading={isSubmitting} />
				</div>
			</div>

			{/* Content sections — bordered column like Tembo */}
			<div className="flex-1 border-l border-r border-border/50 mx-auto w-full max-w-3xl">
				<div className="flex flex-col gap-10 px-4 pb-10">
					{/* Get Started — horizontal onboarding cards */}
					{/* <OnboardingSection /> */}

					{/* Needs Attention — triage items from agent runs */}
					<NeedsAttention />

					{/* Recent Activity — unified sessions list */}
					<RecentActivity />
				</div>
			</div>
		</div>
	);
}
