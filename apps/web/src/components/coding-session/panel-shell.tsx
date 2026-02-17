"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { X } from "lucide-react";

interface PanelShellProps {
	title: string;
	icon?: React.ReactNode;
	/** Toolbar actions rendered before the close button */
	actions?: React.ReactNode;
	/** Disable default body padding (for edge-to-edge iframes, terminals) */
	noPadding?: boolean;
	children: React.ReactNode;
}

export function PanelShell({ title, icon, actions, noPadding, children }: PanelShellProps) {
	const closePanel = usePreviewPanelStore((s) => s.closePanel);

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full w-full bg-background overflow-hidden">
				{/* Standardized header */}
				<div className="h-10 px-3 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{icon && (
							<span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
						)}
						<span className="text-sm font-medium truncate">{title}</span>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{actions}
						{actions && <div className="w-px h-4 bg-border mx-0.5" />}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={closePanel}>
									<X className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Close panel</TooltipContent>
						</Tooltip>
					</div>
				</div>

				{/* Content */}
				<div className={cn("flex-1 min-h-0 overflow-hidden", !noPadding && "overflow-y-auto")}>
					{children}
				</div>
			</div>
		</TooltipProvider>
	);
}
