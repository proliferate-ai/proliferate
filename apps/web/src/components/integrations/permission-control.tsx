"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PERMISSION_MODES } from "@/config/integrations";
import { cn } from "@/lib/display/utils";

type ActionMode = "allow" | "require_approval" | "deny";

interface PermissionControlProps {
	value: ActionMode;
	onChange: (mode: ActionMode) => void;
	disabled?: boolean;
}

export function PermissionControl({ value, onChange, disabled }: PermissionControlProps) {
	return (
		<TooltipProvider delayDuration={300}>
			<div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
				{PERMISSION_MODES.map((mode) => (
					<Tooltip key={mode.value}>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={disabled}
								onClick={() => onChange(mode.value)}
								className={cn(
									"px-2 py-1 text-xs font-medium rounded-sm flex items-center gap-1.5 h-auto",
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
							</Button>
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
