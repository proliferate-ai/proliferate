"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PreviewMode } from "@/stores/preview-panel";
import { Circle, Globe, HardDrive, MessageSquare, PanelRight, Settings } from "lucide-react";

interface SessionHeaderProps {
	sessionStatus?: string;
	error: string | null;
	// Panel state
	panelMode: PreviewMode;
	onTogglePreview?: () => void;
	onToggleSessionInfo?: () => void;
	onToggleSnapshots?: () => void;
	// Mobile
	mobileView?: "chat" | "preview";
	onToggleMobileView?: () => void;
	isMigrating?: boolean;
}

export function SessionHeader({
	sessionStatus,
	error,
	panelMode,
	onTogglePreview,
	onToggleSessionInfo,
	onToggleSnapshots,
	mobileView,
	onToggleMobileView,
	isMigrating,
}: SessionHeaderProps) {
	const isRunning = sessionStatus === "running" || sessionStatus === "starting";
	const isPanelOpen = panelMode.type !== "none";

	const statusLabel = isMigrating ? "Extending" : isRunning ? "Open" : "Closed";
	const statusTooltip = isMigrating
		? "Session is extending"
		: isRunning
			? "Session is running"
			: "Session is closed";

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

				{/* Status badge */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div
							className={cn(
								"flex items-center gap-1.5 rounded-full px-2 py-0.5",
								isMigrating
									? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
									: isRunning
										? "bg-green-500/10 text-green-600 dark:text-green-400"
										: "bg-muted text-muted-foreground",
							)}
						>
							<Circle
								className={cn(
									"h-2 w-2 fill-current",
									isMigrating
										? "text-yellow-500 animate-pulse"
										: isRunning
											? "text-green-500"
											: "text-muted-foreground/50",
								)}
							/>
							<span className="hidden md:inline text-[10px] font-medium uppercase tracking-wide">
								{statusLabel}
							</span>
						</div>
					</TooltipTrigger>
					<TooltipContent>{statusTooltip}</TooltipContent>
				</Tooltip>

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
