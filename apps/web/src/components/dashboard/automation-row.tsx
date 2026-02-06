"use client";

import { type Provider, ProviderIcon } from "@/components/integrations/provider-icon";
import { StatusDot } from "@/components/ui/status-dot";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";

interface AutomationRowProps {
	name: string;
	enabled: boolean;
	updatedAt: string;
	providers?: string[];
	creatorName?: string | null;
	className?: string;
}

/**
 * Display-only automation row component.
 * Used in sidebar and command search for consistent display.
 */
export function AutomationRow({
	name,
	enabled,
	updatedAt,
	providers = [],
	creatorName,
	className,
}: AutomationRowProps) {
	const displayProviders = providers.slice(0, 2);
	const relativeTime = formatRelativeTime(updatedAt);

	return (
		<div className={cn("flex items-start min-w-0", className)}>
			{displayProviders.length > 0 ? (
				<div className="flex items-center mr-2 flex-shrink-0 gap-0.5 mt-0.5">
					{displayProviders.map((provider) => (
						<ProviderIcon
							key={provider}
							provider={provider as Provider}
							size="sm"
							className="h-3.5 w-3.5"
						/>
					))}
				</div>
			) : (
				<div className="w-3.5 mr-2 flex-shrink-0" />
			)}
			<div className="flex-1 min-w-0">
				<Text variant="small" className="font-medium truncate">
					{name}
				</Text>
				<Text variant="small" color="muted" className="text-xs truncate">
					{relativeTime}
					{creatorName && ` · ${creatorName}`}
				</Text>
			</div>
			<StatusDot
				status={enabled ? "active" : "paused"}
				showWhenInactive={true}
				className="ml-2 mt-1 flex-shrink-0"
			/>
		</div>
	);
}
