"use client";

import { Button } from "@/components/ui/button";
import { AutomationsIcon } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/textarea";
import { useAssignRun, useResolveRun, useRun, useRunEvents } from "@/hooks/use-automations";
import { useSession } from "@/lib/auth-client";
import { getRunStatusDisplay } from "@/lib/run-status";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Check, CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface InvestigationPanelProps {
	runId: string;
}

export function InvestigationPanel({ runId }: InvestigationPanelProps) {
	const { data: run, isLoading: runLoading } = useRun(runId);
	const { data: events, isLoading: eventsLoading } = useRunEvents(runId);
	const { data: authSession } = useSession();
	const assignRun = useAssignRun(run?.automation_id ?? "");

	if (runLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!run) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">Run not found</p>
			</div>
		);
	}

	const statusDisplay = getRunStatusDisplay(run.status);
	const StatusIcon = statusDisplay.icon;
	const isResolvable =
		run.status === "failed" || run.status === "needs_human" || run.status === "timed_out";

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			<div className="p-4 space-y-4">
				{/* Status header */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<StatusIcon
							className={cn(
								"h-4 w-4",
								statusDisplay.className,
								run.status === "running" && "animate-spin",
							)}
						/>
						<span className="text-sm font-medium">{statusDisplay.label}</span>
					</div>
					<Link
						href={`/dashboard/automations/${run.automation_id}/events`}
						className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
					>
						<AutomationsIcon className="h-3 w-3" />
						<span>Automation</span>
						<ExternalLink className="h-3 w-3" />
					</Link>
				</div>

				{/* Error section */}
				{run.error_message && (
					<div className="space-y-1">
						<p className="text-xs font-medium text-muted-foreground">Error</p>
						<div className="rounded-md bg-muted/50 p-3">
							<p className="text-sm text-foreground whitespace-pre-wrap">{run.error_message}</p>
						</div>
						{run.status_reason && (
							<p className="text-xs text-muted-foreground">{run.status_reason}</p>
						)}
					</div>
				)}

				{/* Trigger context */}
				{run.trigger && (
					<div className="space-y-1">
						<p className="text-xs font-medium text-muted-foreground">Trigger</p>
						<div className="flex items-center gap-2 text-sm">
							<span>{run.trigger.name ?? "Unnamed trigger"}</span>
							<span className="text-xs text-muted-foreground">({run.trigger.provider})</span>
						</div>
						{run.trigger_event?.parsed_context && (
							<p className="text-xs text-muted-foreground truncate">
								{JSON.stringify(run.trigger_event.parsed_context)}
							</p>
						)}
					</div>
				)}

				{/* Assignee */}
				{run.assignee ? (
					<div className="space-y-1">
						<p className="text-xs font-medium text-muted-foreground">Assigned to</p>
						<p className="text-sm">{run.assignee.name}</p>
					</div>
				) : isResolvable && authSession?.user?.id ? (
					<div className="space-y-1">
						<p className="text-xs font-medium text-muted-foreground">Assigned to</p>
						<div className="flex items-center gap-2">
							<p className="text-sm text-muted-foreground">Unassigned</p>
							<Button
								size="sm"
								variant="outline"
								className="h-7 text-xs"
								disabled={assignRun.isPending}
								onClick={() =>
									assignRun.mutate({
										id: run.automation_id,
										runId,
									})
								}
							>
								{assignRun.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
								Claim
							</Button>
						</div>
					</div>
				) : null}

				{/* Timeline */}
				<div className="space-y-1">
					<p className="text-xs font-medium text-muted-foreground">Timeline</p>
					{eventsLoading ? (
						<div className="flex items-center gap-2 py-2">
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							<span className="text-xs text-muted-foreground">Loading events...</span>
						</div>
					) : events && events.length > 0 ? (
						<div className="space-y-0">
							{events.map((event) => (
								<div key={event.id} className="flex items-start gap-2.5 py-1.5 text-xs">
									<span className="text-muted-foreground whitespace-nowrap shrink-0 w-16">
										{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
									</span>
									<span className="text-foreground">
										{event.type}
										{event.from_status && event.to_status && (
											<span className="text-muted-foreground">
												{" "}
												({event.from_status} → {event.to_status})
											</span>
										)}
									</span>
								</div>
							))}
						</div>
					) : (
						<p className="text-xs text-muted-foreground py-1">No events recorded</p>
					)}
				</div>

				{/* Resolution section */}
				{isResolvable && <ResolutionSection runId={runId} automationId={run.automation_id} />}
			</div>
		</div>
	);
}

function ResolutionSection({
	runId,
	automationId,
}: {
	runId: string;
	automationId: string;
}) {
	const resolveRun = useResolveRun();
	const [activeOutcome, setActiveOutcome] = useState<"succeeded" | "failed" | null>(null);
	const [comment, setComment] = useState("");

	const handleResolve = async () => {
		if (!activeOutcome) return;
		try {
			await resolveRun.mutateAsync({
				id: automationId,
				runId,
				outcome: activeOutcome,
				comment: comment || undefined,
			});
			setActiveOutcome(null);
			setComment("");
		} catch {
			// Error rendered below via resolveRun.isError
		}
	};

	return (
		<div className="space-y-2">
			<p className="text-xs font-medium text-muted-foreground">Resolve</p>
			<div className="flex items-center gap-1.5">
				<Button
					size="sm"
					variant={activeOutcome === "succeeded" ? "default" : "outline"}
					className="h-7 text-xs"
					onClick={() => setActiveOutcome(activeOutcome === "succeeded" ? null : "succeeded")}
					disabled={resolveRun.isPending}
				>
					<CheckCircle2 className="h-3 w-3 mr-1" />
					Mark Succeeded
				</Button>
				<Button
					size="sm"
					variant={activeOutcome === "failed" ? "destructive" : "outline"}
					className="h-7 text-xs"
					onClick={() => setActiveOutcome(activeOutcome === "failed" ? null : "failed")}
					disabled={resolveRun.isPending}
				>
					<XCircle className="h-3 w-3 mr-1" />
					Mark Failed
				</Button>
			</div>
			{activeOutcome && (
				<div className="space-y-2">
					<Textarea
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						placeholder="Optional comment..."
						className="text-sm min-h-[60px] resize-none"
					/>
					{resolveRun.isError && (
						<p className="text-xs text-destructive">Failed to resolve — please try again.</p>
					)}
					<div className="flex items-center gap-1.5">
						<Button
							size="sm"
							className="h-7 text-xs"
							onClick={handleResolve}
							disabled={resolveRun.isPending}
						>
							{resolveRun.isPending ? (
								<Loader2 className="h-3 w-3 animate-spin mr-1" />
							) : (
								<Check className="h-3 w-3 mr-1" />
							)}
							Confirm
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-xs"
							onClick={() => {
								setActiveOutcome(null);
								setComment("");
							}}
							disabled={resolveRun.isPending}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
