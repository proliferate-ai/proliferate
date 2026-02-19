"use client";

import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { LinearIcon, OpenCodeIcon, SlackIcon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/status-dot";
import { formatRelativeTime } from "@/lib/utils";
import { Building2 } from "lucide-react";
import Link from "next/link";

interface ToolConfig {
	enabled?: boolean;
	[key: string]: unknown;
}

interface EnabledTools {
	slack_notify?: ToolConfig;
	create_linear_issue?: ToolConfig;
	create_session?: ToolConfig;
}

const ACTION_TOOLS = [
	{ key: "create_session" as const, label: "Agent", Icon: OpenCodeIcon, defaultOn: true },
	{ key: "slack_notify" as const, label: "Slack", Icon: SlackIcon },
	{ key: "create_linear_issue" as const, label: "Linear", Icon: LinearIcon },
];

interface AutomationListRowProps {
	id: string;
	name: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	triggerCount: number;
	scheduleCount: number;
	activeProviders: string[];
	enabledTools?: Record<string, unknown> | null;
}

export function AutomationListRow({
	id,
	name,
	enabled,
	createdAt,
	updatedAt,
	triggerCount,
	scheduleCount,
	activeProviders,
	enabledTools,
}: AutomationListRowProps) {
	const totalTriggers = triggerCount + scheduleCount;
	const tools = (enabledTools ?? {}) as EnabledTools;

	const activeActions = ACTION_TOOLS.filter((t) => {
		const cfg = tools[t.key];
		if (t.defaultOn) return cfg?.enabled !== false;
		return cfg?.enabled === true;
	});

	return (
		<Link
			href={`/dashboard/automations/${id}`}
			className="group flex items-center gap-4 px-4 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors text-sm last:border-0"
		>
			{/* Status + Name */}
			<div className="flex items-center gap-2.5 min-w-0 flex-1">
				<StatusDot status={enabled ? "active" : "paused"} size="sm" className="shrink-0" />
				<span className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
					{name}
				</span>
			</div>

			{/* Scope */}
			<div className="hidden sm:flex items-center gap-1.5 w-16 shrink-0">
				<Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
				<span className="text-xs text-muted-foreground">Org</span>
			</div>

			{/* Triggers */}
			<div className="hidden md:flex items-center gap-1.5 w-28 shrink-0">
				{activeProviders.length > 0 && (
					<div className="flex items-center gap-0.5">
						{activeProviders.slice(0, 3).map((provider) => (
							<ProviderIcon
								key={provider}
								provider={provider as Provider}
								size="sm"
								className="text-muted-foreground"
							/>
						))}
					</div>
				)}
				<span className="text-xs text-muted-foreground">
					{totalTriggers === 0
						? "No triggers"
						: `${totalTriggers} ${totalTriggers === 1 ? "trigger" : "triggers"}`}
				</span>
			</div>

			{/* Actions */}
			<div className="hidden md:flex items-center gap-1 w-24 shrink-0">
				{activeActions.length > 0 ? (
					<div className="flex items-center gap-0.5">
						{activeActions.map((t) => (
							<t.Icon key={t.key} className="h-3.5 w-3.5 text-muted-foreground" />
						))}
					</div>
				) : (
					<span className="text-xs text-muted-foreground/50">—</span>
				)}
			</div>

			{/* Created */}
			<div className="hidden lg:block w-16 shrink-0 text-right">
				<span className="text-xs text-muted-foreground">{formatRelativeTime(createdAt)}</span>
			</div>

			{/* Last updated */}
			<div className="w-16 shrink-0 text-right">
				<span className="text-xs text-muted-foreground">{formatRelativeTime(updatedAt)}</span>
			</div>
		</Link>
	);
}
