"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MobileView } from "@/stores/preview-panel";
import {
	Box,
	Camera,
	Circle,
	Clock,
	GitBranch,
	Key,
	Loader2,
	MessageSquare,
	Moon,
	PanelRight,
	Sun,
	Users,
} from "lucide-react";
import { useTheme } from "next-themes";

interface SessionHeaderProps {
	sessionId: string;
	sessionStatus?: string;
	error: string | null;
	title?: string | null;
	repoName?: string | null;
	branchName?: string | null;
	snapshotId?: string | null;
	startedAt?: string | null;
	concurrentUsers?: number;
	isModal?: boolean;
	onSnapshot?: () => void;
	isSnapshotting?: boolean;
	canSnapshot?: boolean;
	onSecretsClick?: () => void;
	showPreview?: boolean;
	onTogglePreview?: () => void;
	hasPreviewUrl?: boolean;
	mobileView?: MobileView;
	onToggleMobileView?: () => void;
	children?: React.ReactNode;
	isMigrating?: boolean;
}

function formatAge(dateString: string | null | undefined): string {
	if (!dateString) return "";
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d`;
}

function getRepoShortName(fullName: string | null | undefined): string {
	if (!fullName) return "";
	const parts = fullName.split("/");
	return parts[parts.length - 1];
}

export function SessionHeader({
	sessionId,
	sessionStatus,
	error,
	title,
	repoName,
	branchName,
	snapshotId,
	startedAt,
	concurrentUsers = 1,
	isModal,
	onSnapshot,
	isSnapshotting,
	canSnapshot,
	onSecretsClick,
	showPreview,
	onTogglePreview,
	hasPreviewUrl,
	mobileView,
	onToggleMobileView,
	children,
	isMigrating,
}: SessionHeaderProps) {
	// Session is "live" if status is running or starting
	const isLive = sessionStatus === "running" || sessionStatus === "starting";
	const { theme, setTheme } = useTheme();

	// Build display title with fallback
	const repoShortName = getRepoShortName(repoName);
	const displayTitle =
		title || (repoShortName ? `${repoShortName}${branchName ? ` (${branchName})` : ""}` : null);

	return (
		<header className="flex items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-3 md:px-4 py-2">
			{/* Left side - title and custom content */}
			<div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
				{children}
				{displayTitle && (
					<span
						className={cn(
							"text-sm truncate max-w-[150px] md:max-w-[300px]",
							title ? "font-medium" : "text-muted-foreground italic",
						)}
						title={title || `${repoName}${branchName ? ` (${branchName})` : ""}`}
					>
						{displayTitle}
					</span>
				)}
			</div>

			{/* Right side - session metadata */}
			<div className="flex items-center gap-2 md:gap-4 text-xs text-muted-foreground md:pr-8">
				{/* Concurrent users - hidden on mobile */}
				{concurrentUsers > 0 && (
					<div className="hidden md:flex items-center gap-1.5" title="Active users">
						<Users className="h-3.5 w-3.5" />
						<span>{concurrentUsers}</span>
					</div>
				)}

				{/* Session age - hidden on mobile */}
				{startedAt && (
					<div className="hidden md:flex items-center gap-1.5" title="Session age">
						<Clock className="h-3.5 w-3.5" />
						<span>{formatAge(startedAt)}</span>
					</div>
				)}

				{/* Snapshot/Image - hidden on mobile */}
				{snapshotId && (
					<div
						className="hidden md:flex items-center gap-1.5 max-w-[120px]"
						title={`Snapshot: ${snapshotId}`}
					>
						<Box className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate font-mono">{snapshotId.slice(0, 8)}</span>
					</div>
				)}

				{/* Branch - hidden on mobile */}
				{branchName && (
					<div
						className="hidden md:flex items-center gap-1.5 max-w-[150px]"
						title={`Branch: ${branchName}`}
					>
						<GitBranch className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate font-mono">{branchName}</span>
					</div>
				)}

				{/* Save Snapshot button - hidden on mobile */}
				{onSnapshot && (
					<Button
						variant="ghost"
						size="icon"
						className="hidden md:flex h-7 w-7"
						onClick={onSnapshot}
						disabled={!canSnapshot || isSnapshotting}
						title="Save Snapshot"
					>
						{isSnapshotting ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Camera className="h-3.5 w-3.5" />
						)}
						<span className="sr-only">Save Snapshot</span>
					</Button>
				)}

				{/* Secrets button - only in modal mode, hidden on mobile */}
				{isModal && onSecretsClick && (
					<Button
						variant="ghost"
						size="icon"
						className="hidden md:flex h-7 w-7"
						onClick={onSecretsClick}
						title="Manage Secrets"
					>
						<Key className="h-3.5 w-3.5" />
						<span className="sr-only">Manage Secrets</span>
					</Button>
				)}

				{/* Mobile view toggle - only on mobile when preview is available */}
				{showPreview && onToggleMobileView && (
					<Button
						variant={mobileView === "preview" ? "secondary" : "ghost"}
						size="icon"
						className="h-8 w-8 md:hidden"
						onClick={onToggleMobileView}
						title={mobileView === "chat" ? "Show Preview" : "Show Chat"}
					>
						{mobileView === "chat" ? (
							<PanelRight className="h-4 w-4" />
						) : (
							<MessageSquare className="h-4 w-4" />
						)}
					</Button>
				)}

				{/* Preview toggle button - desktop only */}
				{onTogglePreview && (
					<Button
						variant={showPreview ? "secondary" : "ghost"}
						size="icon"
						className="hidden md:flex h-7 w-7"
						onClick={onTogglePreview}
						title={showPreview ? "Hide Preview" : "Show Preview"}
						disabled={!hasPreviewUrl && !showPreview}
					>
						<PanelRight className="h-3.5 w-3.5" />
						<span className="sr-only">{showPreview ? "Hide Preview" : "Show Preview"}</span>
					</Button>
				)}

				{/* Theme toggle - only in modal mode, hidden on mobile */}
				{isModal && (
					<Button
						variant="ghost"
						size="icon"
						className="hidden md:flex h-7 w-7"
						onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
					>
						<Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
						<Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
						<span className="sr-only">Toggle theme</span>
					</Button>
				)}

				{/* Session status */}
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
					<span className="text-destructive" title={error}>
						Error
					</span>
				)}
			</div>
		</header>
	);
}
