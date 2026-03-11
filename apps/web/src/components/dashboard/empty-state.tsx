"use client";

import { SessionListRow } from "@/components/sessions/session-card";
import { useOrgPendingRuns } from "@/hooks/automations/use-automations";
import { useCreateConfiguration } from "@/hooks/sessions/use-configurations";
import { useCreateSession, useSessions } from "@/hooks/sessions/use-sessions";
import { useSession } from "@/lib/auth/client";
import { cn } from "@/lib/display/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { modelSupportsReasoning } from "@proliferate/shared/agents";
import type { PendingRunSummary } from "@proliferate/shared/contracts/automations";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { EmptyChatsIllustration, PageEmptyState, PlusBadge } from "./page-empty-state";
import { PromptInput } from "./prompt-input";
import { ActivitySummary } from "./session-stats";

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
}: {
	title: string;
	subtitle?: string;
	actionLabel?: string;
	actionHref?: string;
}) {
	return (
		<div className="flex items-end justify-between mb-3">
			<div>
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
				{subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
			</div>
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
				actionLabel="Sessions"
				actionHref="/sessions"
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
								run.session_id
									? `/workspace/${run.session_id}`
									: run.automation_id
										? `/coworkers/${run.automation_id}/events?runId=${run.id}`
										: "/coworkers"
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
										? "border-warning/30 text-warning"
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

function RecentActivitySkeleton() {
	return (
		<div className="w-full">
			<div className="flex items-end justify-between mb-3">
				<div>
					<div className="h-5 w-32 rounded bg-muted animate-pulse" />
					<div className="h-3.5 w-48 rounded bg-muted animate-pulse mt-1.5" />
				</div>
				<div className="h-4 w-20 rounded bg-muted animate-pulse" />
			</div>
			<div className="rounded-lg border border-border bg-card overflow-hidden">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="flex items-center px-4 py-2.5 border-b border-border/50 last:border-0 gap-3 animate-pulse"
					>
						<div className="h-1.5 w-1.5 rounded-full bg-muted shrink-0" />
						<div
							className="h-4 rounded bg-muted"
							style={{ width: `${120 + ((i * 47) % 140)}px` }}
						/>
						<div className="flex-1" />
						<div className="h-3 w-16 rounded bg-muted hidden md:block" />
						<div className="h-3.5 w-14 rounded bg-muted" />
						<div className="h-3 w-12 rounded bg-muted" />
					</div>
				))}
			</div>
		</div>
	);
}

function RecentActivity({ sessions }: { sessions: Session[] }) {
	if (sessions.length === 0) return null;

	const sorted = [...sessions].sort(
		(a, b) =>
			new Date(b.lastActivityAt ?? b.startedAt ?? 0).getTime() -
			new Date(a.lastActivityAt ?? a.startedAt ?? 0).getTime(),
	);

	return (
		<div className="w-full">
			<SectionHeader
				title="Recent Activity"
				subtitle="Pick up where you left off"
				actionLabel="All Sessions"
				actionHref="/sessions"
			/>
			<div className="rounded-lg border border-border bg-card overflow-hidden">
				{sorted.map((session) => (
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
	const { selectedRepoId, selectedSnapshotId, selectedModel, reasoningEffort, setPendingPrompt } =
		useDashboardStore();
	const createConfiguration = useCreateConfiguration();
	const createSession = useCreateSession();

	const { data: sessions, isLoading: sessionsLoading } = useSessions({
		limit: 5,
		excludeCli: true,
		sortBy: "recency",
		refetchInterval: 5000,
	});

	const hasSessions = !sessionsLoading && (sessions ?? []).length > 0;
	const isEmpty = !sessionsLoading && (sessions ?? []).length === 0;

	const firstName = authSession?.user?.name?.split(" ")[0] ?? "";
	const greeting = firstName ? getGreeting(firstName) : "How can I help you today?";

	const handleSubmit = async (prompt: string) => {
		setPendingPrompt(prompt);

		try {
			const sessionOptions = {
				modelId: selectedModel,
				reasoningEffort:
					reasoningEffort !== "normal" && modelSupportsReasoning(selectedModel)
						? reasoningEffort
						: undefined,
				initialPrompt: prompt,
			};

			let configurationId = selectedSnapshotId ?? undefined;

			if (!configurationId && selectedRepoId) {
				const configurationResult = await createConfiguration.mutateAsync({
					repoIds: [selectedRepoId],
				});
				configurationId = configurationResult.configurationId;
			}

			try {
				await createSession.mutateAsync({
					...sessionOptions,
					...(configurationId ? { configurationId } : {}),
				});
			} catch (sessionError) {
				const isConfigError =
					configurationId &&
					sessionError instanceof Error &&
					/configuration not found/i.test(sessionError.message);
				if (isConfigError) {
					useDashboardStore.getState().setSelectedSnapshot(null);
					await createSession.mutateAsync(sessionOptions);
				} else {
					throw sessionError;
				}
			}

			setPendingPrompt(null);
		} catch (error) {
			console.error("Failed to create session:", error);
			setPendingPrompt(null);
		}
	};

	const isSubmitting = createConfiguration.isPending || createSession.isPending;

	return (
		<div className="h-full flex flex-col overflow-y-auto">
			{/* Prompt area — always pinned at the same position */}
			<div className="flex flex-col items-center px-4 pt-8 md:pt-16 pb-4">
				<h2 className="text-3xl font-semibold mb-6">{greeting}</h2>
				<div className="w-full ">
					<PromptInput onSubmit={handleSubmit} isLoading={isSubmitting} />
				</div>
			</div>

			<div className="flex-1 border-l border-r border-border/50 mx-auto w-full max-w-3xl">
				<div className="flex flex-col gap-6 px-4 pb-10">
					{sessionsLoading && <RecentActivitySkeleton />}

					{isEmpty && (
						<PageEmptyState
							illustration={<EmptyChatsIllustration />}
							badge={<PlusBadge />}
							title="Start your first session"
							description="Type a prompt above to spin up a coding agent in a cloud environment."
						>
							<Link
								href="/settings/repositories"
								className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								<Plus className="h-3.5 w-3.5" />
								Connect a repository
							</Link>
							<Link
								href="/coworkers"
								className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								<Plus className="h-3.5 w-3.5" />
								Create a coworker
							</Link>
						</PageEmptyState>
					)}

					{hasSessions && <ActivitySummary sessions={sessions!} />}
					<NeedsAttention />
					{hasSessions && <RecentActivity sessions={sessions!} />}
				</div>
			</div>
		</div>
	);
}
