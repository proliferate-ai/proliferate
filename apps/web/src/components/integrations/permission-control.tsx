"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ActionMode = "allow" | "require_approval" | "deny";

interface PermissionControlProps {
	value: ActionMode;
	onChange: (mode: ActionMode) => void;
	disabled?: boolean;
}

const MODES: { value: ActionMode; label: string; dotColor: string; tooltip: string }[] = [
	{
		value: "allow",
		label: "Allow",
		dotColor: "#22c55e",
		tooltip: "Executes automatically without human review",
	},
	{
		value: "require_approval",
		label: "Approval",
		dotColor: "#f59e0b",
		tooltip: "Pauses for human approval (5 min timeout)",
	},
	{
		value: "deny",
		label: "Deny",
		dotColor: "#ef4444",
		tooltip: "Agent is blocked from using this action",
	},
];

export function PermissionControl({ value, onChange, disabled }: PermissionControlProps) {
	return (
		<TooltipProvider delayDuration={300}>
			<div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
				{MODES.map((mode) => (
					<Tooltip key={mode.value}>
						<TooltipTrigger asChild>
							<button
								type="button"
								disabled={disabled}
								onClick={() => onChange(mode.value)}
								className={cn(
									"px-2 py-1 text-xs font-medium rounded-sm transition-colors flex items-center gap-1.5",
									value === mode.value
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
									disabled && "opacity-50 cursor-not-allowed",
								)}
							>
								<span
									className="w-1.5 h-1.5 rounded-full shrink-0"
									style={{
										backgroundColor: value === mode.value ? mode.dotColor : "transparent",
									}}
								/>
								{mode.label}
							</button>
						</TooltipTrigger>
						<TooltipContent side="top" className="max-w-[200px]">
							<p className="text-xs">{mode.tooltip}</p>
						</TooltipContent>
					</Tooltip>
				))}
			</div>
		</TooltipProvider>
	);
}
