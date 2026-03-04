"use client";

import { ProviderIcon, getProviderDisplayName } from "@/components/integrations/provider-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	getEventTypeLabel,
	getSeverityDotClass,
	normalizeProvider,
} from "@/lib/automations/display";
import { cn } from "@/lib/utils";
import type { AutomationRun, ParsedEventContext } from "@proliferate/shared";
import { Bot } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

export function RunDetailSection({ run }: { run: AutomationRun }) {
	const parsedContext = run.trigger_event?.parsed_context as ParsedEventContext | null;
	const provider = normalizeProvider(run.trigger?.provider);
	const eventType = getEventTypeLabel(run.trigger_event?.provider_event_type, provider);

	const rawAnalysis = (parsedContext as Record<string, unknown> | null)
		?.llm_analysis_result as Record<string, unknown> | null;
	const analysis = rawAnalysis
		? {
				severity: typeof rawAnalysis.severity === "string" ? rawAnalysis.severity : null,
				summary: typeof rawAnalysis.summary === "string" ? rawAnalysis.summary : null,
				rootCause: typeof rawAnalysis.rootCause === "string" ? rawAnalysis.rootCause : null,
				recommendedActions: Array.isArray(rawAnalysis.recommendedActions)
					? rawAnalysis.recommendedActions.filter(
							(action): action is string => typeof action === "string",
						)
					: [],
			}
		: null;

	const contextParts = useMemo(() => {
		const parts: string[] = [];
		if (parsedContext?.title) {
			parts.push(parsedContext.title);
		}

		const context = parsedContext as Record<string, unknown> | null;
		if (context?.posthog) {
			const posthog = context.posthog as Record<string, unknown>;
			if (posthog.current_url) parts.push(`URL: ${posthog.current_url}`);
			if (posthog.person) {
				const person = posthog.person as Record<string, unknown>;
				parts.push(`User: ${person.name || person.email || "Anonymous"}`);
			}
		}

		if (context?.sentry) {
			const sentry = context.sentry as Record<string, unknown>;
			if (sentry.issue_title) parts.push(`Issue: ${sentry.issue_title}`);
			if (sentry.project) parts.push(`Project: ${sentry.project}`);
		}

		if (context?.github) {
			const github = context.github as Record<string, unknown>;
			if (github.repo) parts.push(`Repo: ${github.repo}`);
			if (github.title) parts.push(`Title: ${github.title}`);
		}

		return parts;
	}, [parsedContext]);

	return (
		<div className="border-t border-border/60 bg-muted/20 px-4 py-4">
			<div className="grid gap-4 md:grid-cols-2">
				<section className="space-y-2">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Trigger
					</p>
					<div className="flex items-center gap-2">
						<ProviderIcon provider={provider} size="sm" />
						<span className="text-sm font-medium text-foreground">
							{getProviderDisplayName(provider)}
						</span>
						<Badge variant="outline" className="text-[10px] font-medium">
							{eventType}
						</Badge>
					</div>
					{contextParts.length > 0 && (
						<div className="space-y-1">
							{contextParts.map((part) => (
								<p key={part} className="text-xs text-muted-foreground">
									{part}
								</p>
							))}
						</div>
					)}
				</section>

				{analysis && (
					<section className="space-y-2">
						<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Analysis
						</p>
						<div className="flex items-center gap-2">
							<span
								className={cn("h-2.5 w-2.5 rounded-full", getSeverityDotClass(analysis.severity))}
							/>
							<span className="text-sm font-medium capitalize text-foreground">
								{analysis.severity || "Unknown"}
							</span>
						</div>
						{analysis.summary && <p className="text-sm text-foreground">{analysis.summary}</p>}
						{analysis.rootCause && (
							<p className="text-xs text-muted-foreground">
								<span className="font-medium text-foreground">Root cause:</span>{" "}
								{analysis.rootCause}
							</p>
						)}
						{analysis.recommendedActions.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{analysis.recommendedActions.map((action) => (
									<Badge key={action} variant="outline">
										{action}
									</Badge>
								))}
							</div>
						)}
					</section>
				)}
			</div>

			{run.session_id && (
				<div className="mt-4">
					<Link href={`/workspace/${run.session_id}`}>
						<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
							<Bot className="h-3.5 w-3.5" />
							View agent session
						</Button>
					</Link>
				</div>
			)}

			{(run.status_reason || run.error_message) && (
				<div className="mt-4 space-y-1.5">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Status info
					</p>
					{run.status_reason && (
						<p className="text-xs text-muted-foreground">
							<span className="font-medium text-foreground">Reason:</span> {run.status_reason}
						</p>
					)}
					{run.error_message && (
						<p className="text-xs text-destructive">
							<span className="font-medium">Error:</span> {run.error_message}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
