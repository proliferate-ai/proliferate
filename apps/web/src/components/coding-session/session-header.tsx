"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PreviewMode } from "@/stores/preview-panel";
import { Globe, HardDrive, MessageSquare, PanelRight, Settings, Wrench } from "lucide-react";

interface SessionHeaderProps {
	error: string | null;
	// Panel state
	panelMode: PreviewMode;
	onTogglePreview?: () => void;
	onToggleSessionInfo?: () => void;
	onToggleSnapshots?: () => void;
	onToggleAutoStart?: () => void;
	// Mobile
	mobileView?: "chat" | "preview";
	onToggleMobileView?: () => void;
}

export function SessionHeader({
	error,
	panelMode,
	onTogglePreview,
	onToggleSessionInfo,
	onToggleSnapshots,
	onToggleAutoStart,
	mobileView,
	onToggleMobileView,
}: SessionHeaderProps) {
	const isPanelOpen = panelMode.type !== "none";

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex items-center gap-1">
				{/* Panel toggle buttons - desktop */}
				{onTogglePreview && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "url" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onTogglePreview}
							>
								<Globe className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Preview</TooltipContent>
					</Tooltip>
				)}
				{onToggleSessionInfo && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "session-info" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleSessionInfo}
							>
								<Settings className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Session Info</TooltipContent>
					</Tooltip>
				)}
				{onToggleSnapshots && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "snapshots" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleSnapshots}
							>
								<HardDrive className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Snapshots</TooltipContent>
					</Tooltip>
				)}
				{onToggleAutoStart && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "service-commands" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleAutoStart}
							>
								<Wrench className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Auto-start settings</TooltipContent>
					</Tooltip>
				)}

				{/* Mobile view toggle */}
				{isPanelOpen && onToggleMobileView && (
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
		</TooltipProvider>
	);
}
