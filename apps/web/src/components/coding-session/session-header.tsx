"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PreviewMode } from "@/stores/preview-panel";
import { Camera, Circle, Info, MessageSquare, PanelRight } from "lucide-react";

interface SessionHeaderProps {
	sessionStatus?: string;
	error: string | null;
	// Panel state
	panelMode: PreviewMode;
	hasPreviewUrl?: boolean;
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
	hasPreviewUrl,
	onTogglePreview,
	onToggleSessionInfo,
	onToggleSnapshots,
	mobileView,
	onToggleMobileView,
	isMigrating,
}: SessionHeaderProps) {
	const isLive = sessionStatus === "running" || sessionStatus === "starting";
	const isPanelOpen = panelMode.type !== "none";

	return (
		<div className="flex items-center gap-1">
			{/* Panel toggle buttons - desktop */}
			{onTogglePreview && (
				<Button
					variant={panelMode.type === "url" ? "secondary" : "ghost"}
					size="icon"
					className="hidden md:flex h-7 w-7"
					onClick={onTogglePreview}
					title="Preview"
					disabled={!hasPreviewUrl && panelMode.type !== "url"}
				>
					<PanelRight className="h-3.5 w-3.5" />
				</Button>
			)}
			{onToggleSessionInfo && (
				<Button
					variant={panelMode.type === "session-info" ? "secondary" : "ghost"}
					size="icon"
					className="hidden md:flex h-7 w-7"
					onClick={onToggleSessionInfo}
					title="Session Info"
				>
					<Info className="h-3.5 w-3.5" />
				</Button>
			)}
			{onToggleSnapshots && (
				<Button
					variant={panelMode.type === "snapshots" ? "secondary" : "ghost"}
					size="icon"
					className="hidden md:flex h-7 w-7"
					onClick={onToggleSnapshots}
					title="Snapshots"
				>
					<Camera className="h-3.5 w-3.5" />
				</Button>
			)}

			{/* Mobile view toggle */}
			{isPanelOpen && onToggleMobileView && (
				<Button
					variant={mobileView === "preview" ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 md:hidden"
					onClick={onToggleMobileView}
					title={mobileView === "chat" ? "Show Panel" : "Show Chat"}
				>
					{mobileView === "chat" ? (
						<PanelRight className="h-4 w-4" />
					) : (
						<MessageSquare className="h-4 w-4" />
					)}
				</Button>
			)}

			{/* Status badge */}
			<div
				className={cn(
					"flex items-center gap-1.5 rounded-full px-2 py-0.5",
					isMigrating
						? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
						: isLive
							? "bg-green-500/10 text-green-600 dark:text-green-400"
							: "bg-red-500/10 text-red-600 dark:text-red-400",
				)}
			>
				<Circle
					className={cn(
						"h-2 w-2 fill-current",
						isMigrating
							? "text-yellow-500 animate-pulse"
							: isLive
								? "text-green-500"
								: "text-red-500",
					)}
				/>
				<span className="hidden md:inline text-[10px] font-medium uppercase tracking-wide">
					{isMigrating ? "Extending..." : isLive ? "Live" : "Offline"}
				</span>
			</div>

			{/* Error indicator */}
			{error && (
				<span className="text-destructive text-xs" title={error}>
					Error
				</span>
			)}
		</div>
	);
}
