"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRepo } from "@/hooks/use-repos";
import { useSessionData, useSnapshotSession } from "@/hooks/use-sessions";
import { useSession as useBetterAuthSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	ArrowLeft,
	Code,
	GitBranch,
	Globe,
	KeyRound,
	Layers,
	Loader2,
	MoreHorizontal,
	Pin,
	Settings,
	SquareTerminal,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { SessionPanelProps } from "./right-panel";
import { RightPanel } from "./right-panel";
import { SessionHeader } from "./session-header";
import { SessionLoadingShell } from "./session-loading-shell";
import { Thread } from "./thread";
import { SessionContext } from "./tool-ui";
import { useCodingSessionRuntime } from "./use-coding-session-runtime";

const PANEL_TABS = [
	{ type: "url" as const, label: "Preview", icon: Globe },
	{ type: "vscode" as const, label: "Code", icon: Code },
	{ type: "terminal" as const, label: "Terminal", icon: SquareTerminal },
	{ type: "git" as const, label: "Git", icon: GitBranch },
	{ type: "services" as const, label: "Services", icon: Layers },
	{ type: "artifacts" as const, label: "Workspace", icon: Zap },
	{ type: "environment" as const, label: "Env", icon: KeyRound },
	{ type: "settings" as const, label: "Settings", icon: Settings },
];

interface CodingSessionProps {
	sessionId: string;
	title?: string;
	description?: string;
	initialPrompt?: string;
	initialImages?: string[];
	asModal?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onError?: (error: string) => void;
}

export function CodingSession({
	sessionId,
	title,
	description,
	initialPrompt,
	initialImages,
	asModal = false,
	open = true,
	onOpenChange,
}: CodingSessionProps) {
	const { data: authSession, isPending: authLoading } = useBetterAuthSession();
	const { data: sessionData, isLoading: sessionLoading } = useSessionData(sessionId);
	const { data: repoData } = useRepo(sessionData?.repoId || "");

	const {
		status,
		runtime,
		error,
		previewUrl,
		sessionTitle,
		isMigrating,
		activityTick,
		autoStartOutput,
		sendRunAutoStart,
		gitState,
		gitResult,
		sendGetGitStatus,
		sendGitCreateBranch,
		sendGitCommit,
		sendGitPush,
		sendGitCreatePr,
		clearGitResult,
		pendingApprovals,
		wsToken,
	} = useCodingSessionRuntime({
		sessionId,
		initialPrompt,
		initialImages,
		initialTitle: sessionData?.title ?? null,
		clientType: sessionData?.clientType ?? null,
	});

	const snapshotSession = useSnapshotSession();
	const canSnapshot = sessionData?.status === "running" && !!sessionData?.sandboxId;
	const handleSnapshot = async () => {
		const toastId = toast.loading("Preparing snapshot...");
		const stages = [
			{ delay: 3000, message: "Capturing filesystem..." },
			{ delay: 10000, message: "Compressing data..." },
			{ delay: 25000, message: "Almost done..." },
		];
		const timeouts = stages.map(({ delay, message }) =>
			setTimeout(() => toast.loading(message, { id: toastId }), delay),
		);
		try {
			await snapshotSession.mutateAsync(sessionId);
			toast.success("Snapshot saved", { id: toastId });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save snapshot", {
				id: toastId,
			});
		} finally {
			timeouts.forEach(clearTimeout);
		}
	};

	const {
		mode,
		mobileView,
		toggleMobileView,
		togglePanel,
		toggleUrlPreview,
		pinnedTabs,
		pinTab,
		unpinTab,
		panelSizes,
		setPanelSizes,
		missingEnvKeyCount,
	} = usePreviewPanelStore();
	const [viewPickerOpen, setViewPickerOpen] = useState(false);
	const activeType = mode.type === "file" || mode.type === "gallery" ? "artifacts" : mode.type;

	// Combine all loading states
	const isLoading =
		authLoading || sessionLoading || status === "loading" || status === "connecting";
	const isSessionCreating = sessionData?.status === "starting" && !sessionData?.sandboxId;

	// Session props for the right panel
	const sessionPanelProps: SessionPanelProps | undefined = sessionData
		? {
				sessionId,
				activityTick,
				sessionStatus: sessionData.status ?? undefined,
				repoId: sessionData.repoId,
				configurationId: sessionData.configurationId,
				repoName: repoData?.githubRepoName || sessionData.repo?.githubRepoName,
				branchName: sessionData.branchName,
				snapshotId: sessionData.sandboxId,
				startedAt: sessionData.startedAt,
				concurrentUsers: 1,
				isModal: asModal,
				isMigrating,
				canSnapshot,
				isSnapshotting: snapshotSession.isPending,
				onSnapshot: handleSnapshot,
				autoStartOutput,
				sendRunAutoStart,
				gitState,
				gitResult,
				sendGetGitStatus,
				sendGitCreateBranch,
				sendGitCommit,
				sendGitPush,
				sendGitCreatePr,
				clearGitResult,
				pendingApprovals,
			}
		: undefined;

	const displayTitle = sessionTitle || sessionData?.title || title;
	const headerDisabled = isLoading || !authSession || !sessionData || status === "error";

	// Left pane content (chat or loading/error states)
	const leftPaneContent = isLoading ? (
		sessionData ? (
			<SessionLoadingShell
				mode={isSessionCreating ? "creating" : "resuming"}
				stage={
					isSessionCreating ? (status === "connecting" ? "provisioning" : "preparing") : undefined
				}
				repoName={repoData?.githubRepoName || sessionData.repo?.githubRepoName}
				initialPrompt={initialPrompt}
				showHeader={false}
			/>
		) : (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		)
	) : !authSession ? (
		<div className="flex h-full items-center justify-center">
			<p className="text-sm text-destructive">Not authenticated</p>
		</div>
	) : !sessionData ? (
		<div className="flex h-full items-center justify-center">
			<p className="text-sm text-destructive">Session not found</p>
		</div>
	) : status === "error" ? (
		<div className="flex h-full items-center justify-center">
			<p className="text-sm text-destructive">{error || "Connection error"}</p>
		</div>
	) : (
		<SessionContext.Provider value={{ sessionId, repoId: sessionData.repoId ?? undefined }}>
			<Thread
				title={title}
				description={description}
				sessionId={sessionId}
				token={wsToken}
				pendingApprovals={pendingApprovals}
			/>
		</SessionContext.Provider>
	);

	const isReady = !isLoading && !!authSession && !!sessionData && status !== "error";

	const panelViewPicker = (
		<div className="flex items-center gap-0.5">
			{pinnedTabs.map((tabType) => {
				const tab = PANEL_TABS.find((t) => t.type === tabType);
				if (!tab) return null;
				const isActive = activeType === tabType;
				return (
					<Button
						key={tabType}
						variant={isActive ? "secondary" : "ghost"}
						size="sm"
						className={cn(
							"h-7 gap-1.5 text-xs font-medium px-2.5",
							!isActive && "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => {
							if (tab.type === "url") toggleUrlPreview(previewUrl || null);
							else togglePanel(tab.type);
						}}
					>
						<tab.icon className="h-3.5 w-3.5" />
						<span className="hidden lg:inline">{tab.label}</span>
						{tab.type === "environment" && missingEnvKeyCount > 0 && (
							<span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
								{missingEnvKeyCount}
							</span>
						)}
					</Button>
				);
			})}
			<Popover open={viewPickerOpen} onOpenChange={setViewPickerOpen}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
						<MoreHorizontal className="h-3.5 w-3.5" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" sideOffset={8} className="w-48 p-1">
					{PANEL_TABS.map(({ type, label, icon: Icon }) => {
						const isActive = activeType === type;
						const isPinned = pinnedTabs.includes(type);
						return (
							<div key={type} className="flex items-center gap-0.5">
								<Button
									variant="ghost"
									size="sm"
									className={cn(
										"flex-1 justify-start gap-2 h-8 text-sm font-normal px-2.5",
										isActive && "bg-secondary text-secondary-foreground",
									)}
									onClick={() => {
										if (type === "url") toggleUrlPreview(previewUrl || null);
										else togglePanel(type);
										setViewPickerOpen(false);
									}}
								>
									<Icon className="h-4 w-4 shrink-0" />
									{label}
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className={cn(
										"h-7 w-7 shrink-0",
										isPinned ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground",
									)}
									onClick={(e) => {
										e.stopPropagation();
										if (isPinned) unpinTab(type);
										else pinTab(type);
									}}
								>
									<Pin className={cn("h-3 w-3", isPinned && "fill-current")} />
								</Button>
							</div>
						);
					})}
				</PopoverContent>
			</Popover>
		</div>
	);

	// Chat header (embedded in left pane)
	const chatHeader = (
		<div className="shrink-0 flex items-center gap-2 h-12 px-3 border-b border-border/50">
			<Tooltip>
				<TooltipTrigger asChild>
					<Link href="/dashboard">
						<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
							<ArrowLeft className="h-4 w-4" />
						</Button>
					</Link>
				</TooltipTrigger>
				<TooltipContent side="bottom">Back to dashboard</TooltipContent>
			</Tooltip>
			<div className="h-5 w-px bg-border/60 shrink-0" />
			<img
				src="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp"
				alt="Proliferate"
				className="h-5 w-5 rounded-full shrink-0"
			/>
			{displayTitle && (
				<span className="text-sm font-medium text-foreground truncate">{displayTitle}</span>
			)}
			<SessionHeader
				error={headerDisabled ? null : error}
				disabled={headerDisabled}
				mobileView={mobileView}
				onToggleMobileView={toggleMobileView}
				panelMode={mode}
			/>
		</div>
	);

	// Panel tabs header (embedded in right pane)
	const panelTabsHeader = (
		<div className="shrink-0 flex items-center h-12 px-3 border-b border-border/50">
			{panelViewPicker}
		</div>
	);

	// Desktop layout with resizable panels
	const desktopContent = (
		<ResizablePanelGroup
			orientation="horizontal"
			className="h-full w-full"
			onLayoutChanged={(layout) => setPanelSizes(Object.values(layout))}
		>
			{/* Left pane: Chat */}
			<ResizablePanel
				defaultSize={panelSizes[0] || 35}
				minSize={25}
				maxSize={65}
				className="flex flex-col"
			>
				{chatHeader}
				<div className="flex-1 min-h-0 flex flex-col">{leftPaneContent}</div>
			</ResizablePanel>

			{/* Drag handle */}
			<ResizableHandle withHandle />

			{/* Right pane: Tool panels */}
			<ResizablePanel
				defaultSize={panelSizes[1] || 65}
				minSize={35}
				maxSize={75}
				className="flex flex-col"
			>
				{panelTabsHeader}
				<div className="flex-1 min-h-0 p-2">
					<div className="h-full rounded-xl border border-border bg-background overflow-hidden">
						<RightPanel
							isMobileFullScreen={false}
							sessionProps={sessionPanelProps}
							previewUrl={previewUrl}
						/>
					</div>
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);

	// Mobile layout (full-screen toggle between chat and panel)
	const mobileContent = (
		<div className="flex flex-col h-full md:hidden">
			{chatHeader}
			<div className="flex-1 min-h-0">
				{mobileView === "preview" ? (
					<RightPanel isMobileFullScreen sessionProps={sessionPanelProps} previewUrl={previewUrl} />
				) : (
					leftPaneContent
				)}
			</div>
		</div>
	);

	const mainContent = (
		<>
			{/* Desktop: resizable two-pane */}
			<div className="hidden md:flex h-full">{desktopContent}</div>
			{/* Mobile: full-screen toggle */}
			{mobileContent}
		</>
	);

	const content = (
		<TooltipProvider delayDuration={150}>
			<div className="flex h-full flex-col">
				<div className="flex-1 min-h-0">
					{isReady ? (
						<AssistantRuntimeProvider runtime={runtime}>{mainContent}</AssistantRuntimeProvider>
					) : (
						mainContent
					)}
				</div>
			</div>
		</TooltipProvider>
	);

	if (asModal) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-4xl h-[85vh] p-0 gap-0 flex flex-col">
					<DialogTitle className="sr-only">{title || "Coding Session"}</DialogTitle>
					{content}
				</DialogContent>
			</Dialog>
		);
	}

	return content;
}
