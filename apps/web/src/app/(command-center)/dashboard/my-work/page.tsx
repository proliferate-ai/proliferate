"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SessionListRow } from "@/components/sessions/session-card";
import { Button } from "@/components/ui/button";
import { AutomationsIcon } from "@/components/ui/icons";
import { useMyWork } from "@/hooks/use-my-work";
import { formatRelativeTime } from "@/lib/utils";
import { AlertCircle, ExternalLink, Hand, Loader2, Shield, Timer, XCircle } from "lucide-react";
import Link from "next/link";

function getRunStatusInfo(status: string) {
	switch (status) {
		case "failed":
			return { icon: XCircle, label: "Failed", className: "text-red-500" };
		case "needs_human":
			return { icon: Hand, label: "Needs attention", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "Timed out", className: "text-orange-500" };
		default:
			return { icon: AlertCircle, label: status, className: "text-muted-foreground" };
	}
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
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
				</div>
			) : (
				<div className="space-y-6">
					{/* Claimed Runs */}
					{claimedRuns.length > 0 && (
						<section>
							<h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
								Claimed Runs ({claimedRuns.length})
							</h2>
							<div className="rounded-lg border border-border bg-card overflow-hidden">
								{claimedRuns.map((run) => {
									const statusInfo = getRunStatusInfo(run.status);
									const StatusIcon = statusInfo.icon;
									const timeAgo = run.completed_at
										? formatRelativeTime(run.completed_at)
										: formatRelativeTime(run.queued_at);

									return (
										<div
											key={run.id}
											className="flex items-center px-4 py-2.5 border-b border-border/50 last:border-0 gap-3 text-sm"
										>
											<StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusInfo.className}`} />
											<div className="flex items-center gap-1.5 min-w-0 flex-1">
												<AutomationsIcon className="h-3 w-3 text-muted-foreground shrink-0" />
												<span className="font-medium text-foreground truncate">
													Run {run.status}
												</span>
											</div>
											<span className="text-xs text-muted-foreground whitespace-nowrap">
												{timeAgo}
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
								})}
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
