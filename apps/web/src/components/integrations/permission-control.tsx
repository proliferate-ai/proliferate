"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ActionMode = "allow" | "require_approval" | "deny";

interface PermissionControlProps {
	value: ActionMode;
	onChange: (mode: ActionMode) => void;
	disabled?: boolean;
}

// Dot colors: --destructive exists as a semantic token; no --success/--warning tokens exist
// in the design system, so allow/approval use Tailwind palette values as a pragmatic fallback.
const MODES: { value: ActionMode; label: string; dotClass: string; tooltip: string }[] = [
	{
		value: "allow",
		label: "Allow",
		dotClass: "bg-emerald-500",
		tooltip: "Executes automatically without human review",
	},
	{
		value: "require_approval",
		label: "Approval",
		dotClass: "bg-amber-500",
		tooltip: "Pauses for human approval (5 min timeout)",
	},
	{
		value: "deny",
		label: "Deny",
		dotClass: "bg-destructive",
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
									className={cn(
										"w-1.5 h-1.5 rounded-full shrink-0",
										value === mode.value ? mode.dotClass : "bg-transparent",
									)}
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
