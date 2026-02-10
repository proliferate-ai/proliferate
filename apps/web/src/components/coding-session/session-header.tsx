"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PreviewMode } from "@/stores/preview-panel";
import {
	FileDiff,
	GitBranch,
	Globe,
	HardDrive,
	MessageSquare,
	PanelRight,
	Settings,
	SquareTerminal,
	Wrench,
} from "lucide-react";

interface SessionHeaderProps {
	error: string | null;
	disabled?: boolean;
	// Panel state
	panelMode: PreviewMode;
	onTogglePreview?: () => void;
	onToggleSessionInfo?: () => void;
	onToggleSnapshots?: () => void;
	onToggleAutoStart?: () => void;
	onToggleGit?: () => void;
	onToggleChanges?: () => void;
	onToggleTerminal?: () => void;
	// Mobile
	mobileView?: "chat" | "preview";
	onToggleMobileView?: () => void;
}

export function SessionHeader({
	error,
	disabled,
	panelMode,
	onTogglePreview,
	onToggleSessionInfo,
	onToggleSnapshots,
	onToggleAutoStart,
	onToggleGit,
	onToggleChanges,
	onToggleTerminal,
	mobileView,
	onToggleMobileView,
}: SessionHeaderProps) {
	const isPanelOpen = panelMode.type !== "none";

	return (
		<TooltipProvider delayDuration={150}>
			<div className={cn("flex items-center gap-1", disabled && "opacity-50")}>
				{/* Panel toggle buttons - desktop */}
				{onTogglePreview && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="hidden md:inline-flex">
								<Button
									variant={panelMode.type === "url" ? "secondary" : "ghost"}
									size="icon"
									className="h-7 w-7"
									onClick={onTogglePreview}
									disabled={disabled}
								>
									<Globe className="h-3.5 w-3.5" />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>Preview</TooltipContent>
					</Tooltip>
				)}
				{onToggleSessionInfo && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="hidden md:inline-flex">
								<Button
									variant={panelMode.type === "session-info" ? "secondary" : "ghost"}
									size="icon"
									className="h-7 w-7"
									onClick={onToggleSessionInfo}
									disabled={disabled}
								>
									<Settings className="h-3.5 w-3.5" />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>Session Info</TooltipContent>
					</Tooltip>
				)}
				{onToggleSnapshots && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="hidden md:inline-flex">
								<Button
									variant={panelMode.type === "snapshots" ? "secondary" : "ghost"}
									size="icon"
									className="h-7 w-7"
									onClick={onToggleSnapshots}
									disabled={disabled}
								>
									<HardDrive className="h-3.5 w-3.5" />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>Snapshots</TooltipContent>
					</Tooltip>
				)}
				{onToggleAutoStart && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="hidden md:inline-flex">
								<Button
									variant={panelMode.type === "service-commands" ? "secondary" : "ghost"}
									size="icon"
									className="h-7 w-7"
									onClick={onToggleAutoStart}
									disabled={disabled}
								>
									<Wrench className="h-3.5 w-3.5" />
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent>Auto-start settings</TooltipContent>
					</Tooltip>
				)}
				{onToggleGit && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "git" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleGit}
								disabled={disabled}
							>
								<GitBranch className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Git</TooltipContent>
					</Tooltip>
				)}

				{onToggleChanges && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "changes" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleChanges}
								disabled={disabled}
							>
								<FileDiff className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Changes</TooltipContent>
					</Tooltip>
				)}

				{onToggleTerminal && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "terminal" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleTerminal}
								disabled={disabled}
							>
								<SquareTerminal className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Terminal</TooltipContent>
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
