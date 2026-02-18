"use client";

import { SessionListRow } from "@/components/sessions/session-card";
import { useOrgPendingRuns } from "@/hooks/use-automations";
import { useCreateConfiguration } from "@/hooks/use-configurations";
import { useCreateSession, useSessions } from "@/hooks/use-sessions";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { modelSupportsReasoning } from "@proliferate/shared/agents";
import type { PendingRunSummary } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
	const { selectedRepoId, selectedSnapshotId, selectedModel, reasoningEffort, setPendingPrompt } =
		useDashboardStore();
	const createConfiguration = useCreateConfiguration();
	const createSession = useCreateSession();
	const { data: recentSessions } = useSessions({ limit: 1, excludeSetup: true, excludeCli: true });
	const hasSessions = (recentSessions ?? []).length > 0;
	const router = useRouter();

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
			};

			let result: Awaited<ReturnType<typeof createSession.mutateAsync>> | undefined;

			if (!selectedSnapshotId && !selectedRepoId) {
				result = await createSession.mutateAsync(sessionOptions);
			} else {
				let configurationId = selectedSnapshotId;

				if (!configurationId && selectedRepoId) {
					const configurationResult = await createConfiguration.mutateAsync({
						repoIds: [selectedRepoId],
					});
					configurationId = configurationResult.configurationId;
				}

				if (!configurationId) return;

				result = await createSession.mutateAsync({
					...sessionOptions,
					configurationId,
				});
			}

			setPendingPrompt(null);
			if (result?.sessionId) {
				router.push(`/workspace/${result.sessionId}`);
			}
		} catch (error) {
			console.error("Failed to create session:", error);
			setPendingPrompt(null);
		}
	};

	const isSubmitting = createConfiguration.isPending || createSession.isPending;

	return (
		<div className="h-full flex flex-col overflow-y-auto">
			{/* Prompt input area — centered when empty, pinned at top when sessions exist */}
			<div
				className={cn(
					"flex flex-col items-center px-4 pb-6",
					hasSessions ? "pt-8 md:pt-16" : "flex-1 justify-center",
				)}
			>
				<h2 className="text-3xl font-semibold mb-6">{greeting}</h2>
				<div className="w-full max-w-2xl">
					<PromptInput onSubmit={handleSubmit} isLoading={isSubmitting} />
				</div>
			</div>

			{/* Content sections — bordered column like Tembo */}
			<div className="flex-1 border-l border-r border-border/50 mx-auto w-full max-w-3xl">
				<div className="flex flex-col gap-10 px-4 pb-10">
					{/* Activity summary for returning users */}
					{hasSessions && <ActivitySummary />}

					{/* Needs Attention — triage items from agent runs */}
					<NeedsAttention />

					{/* Recent Activity — unified sessions list */}
					<RecentActivity />
				</div>
			</div>
		</div>
	);
}
