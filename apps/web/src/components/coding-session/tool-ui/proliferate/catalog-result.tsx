"use client";

import type { ActionsCatalogSummary } from "@/lib/sessions/proliferate/catalog";

interface ActionsCatalogSummaryViewProps {
	summary: ActionsCatalogSummary;
}

export function ActionsCatalogSummaryView({ summary }: ActionsCatalogSummaryViewProps) {
	return (
		<div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
			<div className="px-3 py-2.5 text-xs">
				<div className="font-medium text-foreground">
					{summary.totalIntegrations} integration{summary.totalIntegrations === 1 ? "" : "s"}{" "}
					available
				</div>
				<div className="mt-0.5 text-muted-foreground">
					{summary.totalActions} action{summary.totalActions === 1 ? "" : "s"} available
				</div>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{summary.names.map((name) => (
						<span
							key={name}
							className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
						>
							{name}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}
