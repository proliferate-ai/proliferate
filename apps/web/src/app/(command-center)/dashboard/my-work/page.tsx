"use client";

import {
	InfoBadge,
	MyWorkIllustration,
	PageEmptyState,
} from "@/components/dashboard/page-empty-state";
import { PageShell } from "@/components/dashboard/page-shell";
import { SessionListRow } from "@/components/sessions/session-card";
import { Button } from "@/components/ui/button";
import { AutomationsIcon } from "@/components/ui/icons";
import { useMyWork } from "@/hooks/use-my-work";
import { useSessionData } from "@/hooks/use-sessions";
import { getRunStatusDisplay } from "@/lib/run-status";
import { formatCompactMetrics } from "@/lib/session-display";
import { formatRelativeTime } from "@/lib/utils";
import type { AutomationRun } from "@proliferate/shared/contracts";
import { ExternalLink, GitPullRequest, Loader2, Shield } from "lucide-react";
import Link from "next/link";

function ClaimedRunRow({ run }: { run: AutomationRun }) {
	const statusInfo = getRunStatusDisplay(run.status);
	const StatusIcon = statusInfo.icon;
	const { data: session } = useSessionData(run.session_id ?? "");

	const timeAgo = run.completed_at
		? formatRelativeTime(run.completed_at)
		: formatRelativeTime(run.queued_at);

	const contextLine = session?.latestTask ?? session?.promptSnippet;
	const metricsStr = session?.metrics ? formatCompactMetrics(session.metrics) : null;
	const prCount = session?.prUrls?.length ?? 0;

	const metaParts = [
		metricsStr,
		prCount > 0 ? `${prCount} PR${prCount > 1 ? "s" : ""}` : null,
		timeAgo,
	].filter(Boolean);

	return (
		<div className="flex items-center px-4 py-2.5 border-b border-border/50 last:border-0 gap-3 text-sm">
			<StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusInfo.className}`} aria-hidden="true" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<AutomationsIcon className="h-3 w-3 text-muted-foreground shrink-0" />
					<span className="font-medium text-foreground truncate">
						{run.session?.title || statusInfo.label}
					</span>
				</div>
				{contextLine && (
					<span className="text-xs text-muted-foreground truncate block mt-0.5">{contextLine}</span>
				)}
			</div>
			<span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
				{prCount > 0 && <GitPullRequest className="h-3 w-3" aria-hidden="true" />}
				{metaParts.join(" · ")}
			</span>
			{run.session_id && (
				<Link href={`/workspace/${run.session_id}?runId=${run.id}`}>
					<Button size="sm" variant="outline" className="h-7 text-xs px-2.5">
						<ExternalLink className="h-3 w-3" />
						<span className="ml-1">Investigate</span>
					</Button>
				</Link>
			)}
		</div>
	);
}

export default function MyWorkPage() {
	const { claimedRuns, activeSessions, pendingApprovals, isLoading } = useMyWork();

	if (isLoading) {
		return (
			<PageShell title="My Work">
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			</PageShell>
		);
	}

	const isEmpty =
		claimedRuns.length === 0 && activeSessions.length === 0 && pendingApprovals.length === 0;

	return (
		<PageShell title="My Work">
			{isEmpty ? (
				<PageEmptyState
					illustration={<MyWorkIllustration />}
					badge={<InfoBadge />}
					title="All clear"
					description="Claimed runs, active sessions, and pending approvals will appear here."
				/>
			) : (
				<div className="space-y-6">
					{/* Claimed Runs */}
					{claimedRuns.length > 0 && (
						<section>
							<h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
								Claimed Runs ({claimedRuns.length})
							</h2>
							<div className="rounded-lg border border-border bg-card overflow-hidden">
								{claimedRuns.map((run) => (
									<ClaimedRunRow key={run.id} run={run} />
								))}
							</div>
						</section>
					)}

					{/* Active Sessions */}
					{activeSessions.length > 0 && (
						<section>
							<h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
								Active Sessions ({activeSessions.length})
							</h2>
							<div className="rounded-lg border border-border bg-card overflow-hidden">
								{activeSessions.map((session) => (
									<SessionListRow key={session.id} session={session} />
								))}
							</div>
						</section>
					)}

					{/* Pending Approvals */}
					{pendingApprovals.length > 0 && (
						<section>
							<h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
								Pending Approvals ({pendingApprovals.length})
							</h2>
							<div className="rounded-lg border border-border bg-card overflow-hidden">
								{pendingApprovals.map((invocation) => (
									<div
										key={invocation.id}
										className="flex items-center px-4 py-2.5 border-b border-border/50 last:border-0 gap-3 text-sm"
									>
										<Shield className="h-3.5 w-3.5 shrink-0 text-amber-500" />
										<div className="min-w-0 flex-1">
											<span className="font-medium text-foreground">{invocation.action}</span>
											<span className="text-muted-foreground ml-1.5">
												on {invocation.integration}
											</span>
										</div>
										{invocation.sessionId && (
											<Link href={`/workspace/${invocation.sessionId}`}>
												<Button size="sm" variant="outline" className="h-7 text-xs px-2.5">
													<ExternalLink className="h-3 w-3" />
													<span className="ml-1">View</span>
												</Button>
											</Link>
										)}
									</div>
								))}
							</div>
						</section>
					)}
				</div>
			)}
		</PageShell>
	);
}
