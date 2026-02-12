"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PreviewMode } from "@/stores/preview-panel";
import {
	Code,
	GitBranch,
	Globe,
	MessageSquare,
	PanelRight,
	Settings,
	SquareTerminal,
	Zap,
} from "lucide-react";

interface SessionHeaderProps {
	error: string | null;
	disabled?: boolean;
	// Panel state
	panelMode: PreviewMode;
	onTogglePreview?: () => void;
	onToggleSettings?: () => void;
	onToggleGit?: () => void;
	onToggleTerminal?: () => void;
	onToggleVscode?: () => void;
	onToggleArtifacts?: () => void;
	// Mobile
	mobileView?: "chat" | "preview";
	onToggleMobileView?: () => void;
}

export function SessionHeader({
	error,
	disabled,
	panelMode,
	onTogglePreview,
	onToggleSettings,
	onToggleGit,
	onToggleTerminal,
	onToggleVscode,
	onToggleArtifacts,
	mobileView,
	onToggleMobileView,
}: SessionHeaderProps) {
	const isPanelOpen = panelMode.type !== "none";
	const isArtifactsActive =
		panelMode.type === "artifacts" || panelMode.type === "file" || panelMode.type === "gallery";

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

				{onToggleSettings && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "settings" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleSettings}
								disabled={disabled}
							>
								<Settings className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Settings</TooltipContent>
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

				{onToggleVscode && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={panelMode.type === "vscode" ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleVscode}
								disabled={disabled}
							>
								<Code className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>VS Code</TooltipContent>
					</Tooltip>
				)}

				{onToggleArtifacts && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={isArtifactsActive ? "secondary" : "ghost"}
								size="icon"
								className="hidden md:flex h-7 w-7"
								onClick={onToggleArtifacts}
								disabled={disabled}
							>
								<Zap className="h-3.5 w-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Artifacts</TooltipContent>
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
