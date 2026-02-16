"use client";

import {
	type Provider,
	ProviderIcon,
	getProviderDisplayName,
} from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import type { ParsedEventContext } from "@proliferate/shared";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	Clock,
	ExternalLink,
	FileText,
	Hand,
	Loader2,
	Play,
	Terminal,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

// ============================================
// Helpers
// ============================================

function getInvocationStatusIcon(status: string) {
	switch (status) {
		case "completed":
			return { icon: Check, className: "text-emerald-600" };
		case "pending":
			return { icon: Hand, className: "text-amber-500" };
		case "approved":
		case "executing":
			return { icon: Loader2, className: "text-blue-500 animate-spin" };
		case "denied":
		case "failed":
		case "expired":
			return { icon: XCircle, className: "text-red-500" };
		default:
			return { icon: Clock, className: "text-muted-foreground" };
	}
}

function getActionIcon(action: string) {
	if (action.includes("file") || action.includes("read") || action.includes("write")) {
		return FileText;
	}
	if (action.includes("terminal") || action.includes("exec") || action.includes("command")) {
		return Terminal;
	}
	return Play;
}

// ============================================
// Run Inspector Page
// ============================================

export default function RunInspectorPage() {
	const params = useParams<{ runId: string }>();
	const router = useRouter();
	const runId = params.runId;

	const { data, isLoading, error } = useQuery({
		...orpc.automations.getRun.queryOptions({ input: { runId } }),
	});

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="mx-auto max-w-3xl px-6 py-8">
				<p className="text-sm text-muted-foreground">Run not found.</p>
				<Button
					variant="ghost"
					size="sm"
					className="mt-2"
					onClick={() => router.push("/dashboard/inbox")}
				>
					<ArrowLeft className="h-4 w-4 mr-1" />
					Back to inbox
				</Button>
			</div>
		);
	}

	const { run, invocations } = data;
	const provider = (run.trigger?.provider || "webhook") as Provider;
	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const analysis = (parsedContext as Record<string, unknown> | null)?.llm_analysis_result as {
		severity: string;
		summary: string;
	} | null;

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
				{/* Header */}
				<div>
					<button
						type="button"
						onClick={() => router.push("/dashboard/inbox")}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
					>
						<ArrowLeft className="h-3 w-3" />
						Inbox
					</button>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<ProviderIcon provider={provider} size="md" />
							<div>
								<h1 className="text-lg font-semibold">{run.automation_name ?? "Run Inspector"}</h1>
								<p className="text-xs text-muted-foreground">
									{getProviderDisplayName(provider)}
									{run.trigger_event?.provider_event_type &&
										` · ${run.trigger_event.provider_event_type}`}
								</p>
							</div>
						</div>
						<RunStatusBadge status={run.status} />
					</div>
				</div>

				{/* Analysis summary */}
				{analysis && (
					<div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
						<p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-medium">
							Analysis
						</p>
						<p className="text-sm">{analysis.summary}</p>
					</div>
				)}

				{/* Error/status reason */}
				{run.error_message && (
					<div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
						<p className="text-xs text-destructive mb-1 uppercase tracking-wider font-medium">
							Error
						</p>
						<p className="text-sm text-destructive">{run.error_message}</p>
					</div>
				)}

				{/* Timeline */}
				<div>
					<p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">
						Action Timeline
					</p>

					{invocations.length === 0 ? (
						<div className="rounded-lg border border-dashed border-border py-8 text-center">
							<Clock className="h-5 w-5 mx-auto mb-2 text-muted-foreground/40" />
							<p className="text-sm text-muted-foreground">No actions recorded for this run yet.</p>
						</div>
					) : (
						<div className="rounded-lg border border-border bg-background overflow-hidden">
							{invocations.map((inv, idx) => {
								const statusInfo = getInvocationStatusIcon(inv.status);
								const StatusIcon = statusInfo.icon;
								const ActionIcon = getActionIcon(inv.action);
								const time = inv.createdAt ? new Date(inv.createdAt) : null;
								const timeStr = time
									? time.toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})
									: "--:--";
								const isPending = inv.status === "pending";

								return (
									<div
										key={inv.id}
										className={cn(
											"flex items-start gap-3 px-4 py-3",
											idx < invocations.length - 1 && "border-b border-border/60",
											isPending && "bg-amber-50/50 dark:bg-amber-950/20",
										)}
									>
										{/* Timestamp */}
										<span className="text-xs font-mono text-muted-foreground w-12 pt-0.5 shrink-0">
											{timeStr}
										</span>

										{/* Status icon */}
										<StatusIcon className={cn("h-4 w-4 mt-0.5 shrink-0", statusInfo.className)} />

										{/* Content */}
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<ActionIcon className="h-3.5 w-3.5 text-muted-foreground" />
												<span className="text-sm font-medium font-mono">
													{inv.integration}.{inv.action}
												</span>
												<span
													className={cn(
														"text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
														inv.riskLevel === "write"
															? "border-amber-500/30 text-amber-600 bg-amber-50 dark:bg-amber-950/30"
															: inv.riskLevel === "danger"
																? "border-red-500/30 text-red-600 bg-red-50 dark:bg-red-950/30"
																: "border-border text-muted-foreground",
													)}
												>
													{inv.riskLevel}
												</span>
											</div>

											{isPending && (
												<p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
													Awaiting Approval
												</p>
											)}
											{inv.status === "denied" && inv.deniedReason && (
												<p className="text-xs text-red-500 mt-1">Denied: {inv.deniedReason}</p>
											)}
											{inv.error && (
												<p className="text-xs text-red-500 mt-1 truncate">{inv.error}</p>
											)}
											{inv.durationMs != null && inv.status === "completed" && (
												<p className="text-xs text-muted-foreground mt-1">{inv.durationMs}ms</p>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Actions footer */}
				<div className="flex items-center gap-3">
					{run.session_id && (
						<Link href={`/workspace/${run.session_id}`}>
							<Button variant="default" size="sm" className="h-8 gap-1.5">
								<ExternalLink className="h-3.5 w-3.5" />
								Take Over in Studio
							</Button>
						</Link>
					)}
					{run.automation_id && (
						<Link href={`/dashboard/automations/${run.automation_id}`}>
							<Button variant="outline" size="sm" className="h-8">
								View Automation
							</Button>
						</Link>
					)}
				</div>

				{/* Bottom spacer */}
				<div className="h-8" />
			</div>
		</div>
	);
}

// ============================================
// Status Badge
// ============================================

function RunStatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		succeeded:
			"bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
		running:
			"bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
		enriching:
			"bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
		queued: "bg-muted text-muted-foreground border-border",
		failed:
			"bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
		needs_human:
			"bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
		timed_out:
			"bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800",
	};

	return (
		<span
			className={cn(
				"inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border",
				styles[status] ?? styles.queued,
			)}
		>
			{status.replace(/_/g, " ")}
		</span>
	);
}
