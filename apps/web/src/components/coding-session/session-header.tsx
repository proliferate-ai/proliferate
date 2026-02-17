"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PreviewMode } from "@/stores/preview-panel";
import { MessageSquare, PanelRight } from "lucide-react";

interface SessionHeaderProps {
	error: string | null;
	disabled?: boolean;
	panelMode: PreviewMode;
	// Mobile
	mobileView?: "chat" | "preview";
	onToggleMobileView?: () => void;
}

export function SessionHeader({
	error,
	disabled,
	panelMode,
	mobileView,
	onToggleMobileView,
}: SessionHeaderProps) {
	return (
		<div className={cn("flex items-center gap-1", disabled && "opacity-50")}>
			{/* Mobile view toggle */}
			{onToggleMobileView && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant={mobileView === "preview" ? "secondary" : "ghost"}
							size="icon"
							className="h-8 w-8 md:hidden"
							onClick={onToggleMobileView}
						>
							{mobileView === "chat" ? (
								<PanelRight className="h-4 w-4" />
							) : (
								<MessageSquare className="h-4 w-4" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{mobileView === "chat" ? "Show Panel" : "Show Chat"}</TooltipContent>
				</Tooltip>
			)}

			{/* Error indicator */}
			{error && (
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="text-destructive text-xs cursor-default">Error</span>
					</TooltipTrigger>
					<TooltipContent>{error}</TooltipContent>
				</Tooltip>
			)}
		</div>
	);
}
