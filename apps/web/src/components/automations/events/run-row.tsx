"use client";

import { RunDetailSection } from "@/components/automations/events/run-detail-section";
import { RunStatusPill } from "@/components/automations/events/run-status-pill";
import { ProviderIcon } from "@/components/integrations/provider-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getEventTypeLabel, normalizeProvider } from "@/lib/automations/display";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { AutomationRun, ParsedEventContext } from "@proliferate/shared";
import { Bot, ChevronRight } from "lucide-react";

export function RunRow({
	run,
	isExpanded,
	onToggle,
}: {
	run: AutomationRun;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const provider = normalizeProvider(run.trigger?.provider);
	const eventType = getEventTypeLabel(run.trigger_event?.provider_event_type, provider);

	const title = parsedContext?.title || run.trigger?.name || "Automation run";
	const timeAgo = run.queued_at ? formatRelativeTime(run.queued_at) : "unknown";
	const exactTime = run.queued_at ? new Date(run.queued_at).toLocaleString() : "";
	const hasSession = !!run.session_id;

	return (
		<div className="border-b border-border/60 last:border-b-0">
			<Button
				variant="ghost"
				onClick={onToggle}
				aria-expanded={isExpanded}
				aria-controls={`run-${run.id}-details`}
				className={cn(
					"w-full px-4 py-3 h-auto text-left rounded-none justify-start",
					isExpanded && "bg-muted/30",
				)}
			>
				<div className="flex w-full items-start gap-3">
					<div className="mt-0.5 text-muted-foreground">
						<ProviderIcon provider={provider} size="sm" />
					</div>

					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="truncate text-sm font-medium text-foreground">{title}</span>
							{hasSession && (
								<Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
									<Bot className="mr-1 h-2.5 w-2.5" />
									Session
								</Badge>
							)}
							{run.assignee && (
								<Avatar className="h-5 w-5">
									<AvatarImage src={run.assignee.image ?? undefined} />
									<AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
										{run.assignee.name?.[0]?.toUpperCase() ?? "?"}
									</AvatarFallback>
								</Avatar>
							)}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
							<span className="truncate">{eventType}</span>
							<span>·</span>
							<span title={exactTime}>{timeAgo}</span>
						</div>
					</div>

					<div className="flex shrink-0 items-center gap-2 pl-2">
						<RunStatusPill status={run.status} />
						<ChevronRight
							className={cn(
								"h-4 w-4 text-muted-foreground/60 transition-transform",
								isExpanded && "rotate-90",
							)}
						/>
					</div>
				</div>
			</Button>

			{isExpanded && (
				<div id={`run-${run.id}-details`}>
					<RunDetailSection run={run} />
				</div>
			)}
		</div>
	);
}
