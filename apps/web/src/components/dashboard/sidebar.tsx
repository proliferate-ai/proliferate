"use client";

import { openIntercomMessenger } from "@/components/providers";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BoltIcon, SidebarCollapseIcon, SidebarExpandIcon, SlackIcon } from "@/components/ui/icons";
import { ItemActionsMenu } from "@/components/ui/item-actions-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { StatusDot } from "@/components/ui/status-dot";
import { Text } from "@/components/ui/text";
import { useMyClaimedRuns } from "@/hooks/use-automations";
import { useSlackStatus } from "@/hooks/use-integrations";
import { usePrebuilds } from "@/hooks/use-prebuilds";
import {
	useDeleteSession,
	useRenameSession,
	useSessions,
	useSnapshotSession,
} from "@/hooks/use-sessions";
import { useSignOut } from "@/hooks/use-sign-out";
import { useSession } from "@/lib/auth-client";
import { cn, formatRelativeTime, getRepoShortName } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import type { Session } from "@proliferate/shared/contracts";
import {
	Camera,
	ChevronRight,
	LifeBuoy,
	LogOut,
	Menu,
	MessageCircle,
	Moon,
	Plug,
	Plus,
	Settings,
	Sun,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AddSnapshotButton } from "./add-snapshot-button";
import { SearchTrigger } from "./command-search";
import { ConfigurationGroup } from "./configuration-group";

// Mobile sidebar trigger button - shown in mobile header
export function MobileSidebarTrigger() {
	const { setMobileSidebarOpen } = useDashboardStore();

	return (
		<Button
			variant="ghost"
			size="icon"
			className="h-9 w-9 md:hidden"
			onClick={() => setMobileSidebarOpen(true)}
		>
			<Menu className="h-5 w-5" />
			<span className="sr-only">Open menu</span>
		</Button>
	);
}

// Mobile sidebar drawer - full width on mobile
export function MobileSidebar() {
	const { mobileSidebarOpen, setMobileSidebarOpen } = useDashboardStore();

	return (
		<Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
			<SheetContent side="left" className="w-full max-w-full p-0">
				<SidebarContent
					onNavigate={() => setMobileSidebarOpen(false)}
					onClose={() => setMobileSidebarOpen(false)}
				/>
			</SheetContent>
		</Sheet>
	);
}

// Desktop sidebar - hidden on mobile
export function Sidebar() {
	const { sidebarCollapsed, toggleSidebar } = useDashboardStore();

	return (
		<aside
			className={cn(
				"hidden md:flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden",
				"transition-[width] duration-200 ease-out",
				sidebarCollapsed ? "w-12" : "w-64",
			)}
		>
			{/* Expand button - visible when collapsed */}
			<div
				className={cn(
					"absolute p-2 transition-opacity duration-150",
					sidebarCollapsed ? "opacity-100" : "opacity-0 pointer-events-none",
				)}
			>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={toggleSidebar}
					title="Expand sidebar"
				>
					<SidebarExpandIcon className="h-4 w-4" />
				</Button>
			</div>

			{/* Full content - fixed width, fades in when expanded */}
			<div
				className={cn(
					"w-64 flex flex-col h-full transition-opacity duration-200",
					sidebarCollapsed ? "opacity-0 pointer-events-none" : "opacity-100",
				)}
			>
				<SidebarContent showCollapseButton />
			</div>
		</aside>
	);
}

// Shared sidebar content - used by both desktop and mobile
function SidebarContent({
	onNavigate,
	onClose,
	showCollapseButton = false,
}: {
	onNavigate?: () => void;
	onClose?: () => void;
	showCollapseButton?: boolean;
}) {
	const pathname = usePathname();
	const router = useRouter();
	const handleSignOut = useSignOut();
	const { data: authSession } = useSession();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const [userMenuOpen, setUserMenuOpen] = useState(false);
	const [supportMenuOpen, setSupportMenuOpen] = useState(false);

	// Fetch Slack status for support popup
	const { data: slackStatus } = useSlackStatus();
	const { toggleSidebar, setActiveSession, clearPendingPrompt, setCommandSearchOpen } =
		useDashboardStore();

	const user = authSession?.user;
	const userInitials = user?.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: user?.email?.[0]?.toUpperCase() || "?";

	// Fetch claimed runs for sidebar
	const { data: claimedRuns = [] } = useMyClaimedRuns();

	// Fetch sessions
	const { data: sessions } = useSessions();

	// Fetch prebuilds for snapshots section
	interface Prebuild {
		id: string;
		name: string | null;
		snapshotId: string | null;
		createdAt: string;
		type?: "manual" | "managed";
		prebuildRepos?: Array<{
			repo: { id: string; githubRepoName: string } | null;
		}>;
		setupSessions?: Array<{
			id: string;
			sessionType: string;
			status: string;
			title: string | null;
			startedAt: string;
		}>;
	}
	const { data: prebuildsData } = usePrebuilds();

	const prebuilds = (prebuildsData as Prebuild[] | undefined) || [];

	// Filter to coding sessions only (not setup sessions, not CLI)
	const codingSessions = sessions?.filter(
		(session) => session.sessionType !== "setup" && session.origin !== "cli",
	);

	// Group sessions by prebuildId for the Configurations section
	const sessionsByPrebuild = new Map<string, Session[]>();
	const orphanedSessions: Session[] = [];
	for (const session of codingSessions ?? []) {
		if (session.prebuildId) {
			const existing = sessionsByPrebuild.get(session.prebuildId);
			if (existing) {
				existing.push(session);
			} else {
				sessionsByPrebuild.set(session.prebuildId, [session]);
			}
		} else {
			orphanedSessions.push(session);
		}
	}

	// Build a map of session ID → trigger provider for claimed runs
	const claimedSessionProviders = new Map<string, string>();
	for (const run of claimedRuns) {
		if (run.session_id && run.trigger?.provider) {
			claimedSessionProviders.set(run.session_id, run.trigger.provider);
		}
	}

	// Detect active pages from URL
	const isAutomationsPage = pathname?.startsWith("/dashboard/automations");
	const isIntegrationsPage = pathname?.startsWith("/dashboard/integrations");

	// Detect active session from URL
	const isSessionDetailPage =
		pathname?.startsWith("/dashboard/sessions/") && pathname !== "/dashboard/sessions";
	const urlSessionId = isSessionDetailPage ? pathname?.split("/").pop() : null;

	const handleNewSession = () => {
		clearPendingPrompt();
		setActiveSession(null);
		router.push("/dashboard");
		onNavigate?.();
	};

	const handleNavigate = (path: string) => {
		router.push(path);
		onNavigate?.();
	};

	return (
		<>
			{/* Top section: Logo + Collapse/Close */}
			<div className="p-3 flex items-center justify-between gap-2">
				<img
					src={
						resolvedTheme === "dark"
							? "https://d1uh4o7rpdqkkl.cloudfront.net/logotype-inverted.webp"
							: "https://d1uh4o7rpdqkkl.cloudfront.net/logotype.webp"
					}
					alt="Proliferate"
					className="h-5"
				/>
				<div className="flex items-center gap-1">
					{showCollapseButton && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
							onClick={toggleSidebar}
							title="Collapse sidebar"
						>
							<SidebarCollapseIcon className="h-4 w-4" />
						</Button>
					)}
					{onClose && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
							onClick={onClose}
							title="Close menu"
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>

			{/* New Session + Search + Nav */}
			<div className="px-2 mb-2 space-y-1">
				<button
					type="button"
					onClick={handleNewSession}
					className="flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
				>
					<Plus className="h-5 w-5" />
					<span className="text-sm">New session</span>
				</button>
				<SearchTrigger onClick={() => setCommandSearchOpen(true)} />
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/integrations")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isIntegrationsPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<Plug className="h-5 w-5" />
					<span>Integrations</span>
				</button>
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/automations")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isAutomationsPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<BoltIcon className="h-5 w-5" />
					<span>Automations</span>
				</button>
			</div>

			{/* Scrollable content */}
			<div className="flex-1 overflow-y-auto text-sm">
				{/* Threads Section */}
				<div>
					<div className="flex items-center w-full px-4 py-1.5 text-xs text-muted-foreground">
						<span>Threads</span>
						<div className="ml-auto">
							<AddSnapshotButton />
						</div>
					</div>
					<div className="px-2">
						{prebuilds.map((prebuild) => (
							<ConfigurationGroup
								key={prebuild.id}
								prebuild={prebuild}
								sessions={sessionsByPrebuild.get(prebuild.id) ?? []}
								activeSessionId={urlSessionId}
								onNavigate={onNavigate}
							/>
						))}
						{orphanedSessions.length > 0 && (
							<>
								<div className="px-3 py-1 text-xs text-muted-foreground/60">Other</div>
								{orphanedSessions.slice(0, 10).map((session) => (
									<SessionItem
										key={session.id}
										session={session}
										isActive={urlSessionId === session.id}
										onNavigate={onNavigate}
										triggerProvider={claimedSessionProviders.get(session.id)}
									/>
								))}
								{orphanedSessions.length > 10 && (
									<button
										type="button"
										onClick={() => handleNavigate("/dashboard/sessions")}
										className="flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
									>
										<span>View all ({orphanedSessions.length})</span>
									</button>
								)}
							</>
						)}
					</div>
				</div>
			</div>

			{/* Footer with Support button and user card */}
			<div className="border-t border-sidebar-border">
				{/* Support button with popover */}
				<div className="px-3 pt-3 pb-1">
					<Popover open={supportMenuOpen} onOpenChange={setSupportMenuOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="w-full flex items-center justify-center gap-2 px-3 h-9 rounded-lg text-sm font-medium border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border transition-colors"
							>
								<LifeBuoy className="h-4 w-4" />
								<span>Support</span>
							</button>
						</PopoverTrigger>
						<PopoverContent
							side="top"
							align="start"
							className="w-[min(16rem,calc(100vw-2rem))] p-1 z-[60]"
							sideOffset={8}
						>
							<div className="flex flex-col">
								{/* Chat with us - Intercom */}
								<button
									type="button"
									className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left"
									onClick={() => {
										setSupportMenuOpen(false);
										openIntercomMessenger();
									}}
								>
									<MessageCircle className="h-4 w-4 text-muted-foreground" />
									<div className="flex-1">
										<div className="font-medium">Chat with us</div>
										<div className="text-xs text-muted-foreground">Get help instantly</div>
									</div>
								</button>

								<div className="my-1 h-px bg-border" />

								{/* Slack option - three states */}
								{slackStatus?.connected && slackStatus?.supportChannel ? (
									// Fully connected with support channel - open deep link
									<button
										type="button"
										className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left"
										onClick={() => {
											setSupportMenuOpen(false);
											// Use stored invite URL if available, otherwise construct a Slack deep link
											const slackUrl =
												slackStatus.supportChannel?.inviteUrl ||
												(slackStatus.teamId && slackStatus.supportChannel?.channelId
													? `https://app.slack.com/client/${slackStatus.teamId}/${slackStatus.supportChannel.channelId}`
													: null);
											if (slackUrl) {
												window.open(slackUrl, "_blank");
											} else {
												onNavigate?.();
												router.push("/dashboard/integrations");
											}
										}}
									>
										<SlackIcon className="h-4 w-4" />
										<div className="flex-1">
											<div className="font-medium flex items-center gap-2">
												Slack Connect
												<span className="text-xs bg-green-500/10 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">
													Active
												</span>
											</div>
											<div className="text-xs text-muted-foreground">
												#{slackStatus.supportChannel.channelName}
											</div>
										</div>
									</button>
								) : slackStatus?.connected ? (
									// Slack connected but no support channel
									<button
										type="button"
										className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left"
										onClick={() => {
											setSupportMenuOpen(false);
											onNavigate?.();
											router.push("/dashboard/integrations");
										}}
									>
										<SlackIcon className="h-4 w-4" />
										<div className="flex-1">
											<div className="font-medium">Set up Support Channel</div>
											<div className="text-xs text-muted-foreground">
												Get a dedicated Slack Connect channel
											</div>
										</div>
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									</button>
								) : (
									// Slack not connected
									<button
										type="button"
										className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left"
										onClick={() => {
											setSupportMenuOpen(false);
											onNavigate?.();
											router.push("/dashboard/integrations");
										}}
									>
										<SlackIcon className="h-4 w-4" />
										<div className="flex-1">
											<div className="font-medium">Connect Slack</div>
											<div className="text-xs text-muted-foreground">
												For dedicated support channel
											</div>
										</div>
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									</button>
								)}
							</div>
						</PopoverContent>
					</Popover>
				</div>

				{/* User card with popover */}
				<div className="p-3 pt-1">
					<Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="flex items-center gap-3 w-full p-2.5 rounded-xl bg-muted/30 hover:bg-muted transition-all text-left"
							>
								<Avatar className="h-8 w-8">
									<AvatarImage src={user?.image || undefined} alt={user?.name || "User"} />
									<AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
								</Avatar>
								<div className="flex-1 min-w-0">
									<Text variant="small" className="font-medium truncate block">
										{user?.name || "User"}
									</Text>
									<Text variant="small" color="muted" className="text-xs truncate block">
										{user?.email || ""}
									</Text>
								</div>
							</button>
						</PopoverTrigger>
						<PopoverContent side="top" align="end" className="w-56 p-1 z-[60]" sideOffset={8}>
							<div className="flex flex-col">
								<button
									type="button"
									className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-left"
									onClick={() => {
										setUserMenuOpen(false);
										onNavigate?.();
										router.push("/settings");
									}}
								>
									<Settings className="h-4 w-4" />
									Settings
								</button>
								<button
									type="button"
									className="flex items-center justify-between px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
									onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
								>
									<div className="flex items-center gap-2">
										{theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
										{theme === "dark" ? "Dark mode" : "Light mode"}
									</div>
									<div className="text-xs text-muted-foreground">
										{theme === "dark" ? "On" : "Off"}
									</div>
								</button>
								<div className="my-1 h-px bg-border" />
								<button
									type="button"
									className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-left text-muted-foreground hover:text-foreground"
									onClick={() => {
										setUserMenuOpen(false);
										handleSignOut();
									}}
								>
									<LogOut className="h-4 w-4" />
									Log out
								</button>
							</div>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</>
	);
}

function SessionItem({
	session,
	isActive,
	onNavigate,
	triggerProvider,
}: {
	session: Session;
	isActive: boolean;
	onNavigate?: () => void;
	triggerProvider?: string;
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(session.title || "");
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const router = useRouter();
	const { setActiveSession, clearPendingPrompt } = useDashboardStore();

	const renameSession = useRenameSession();
	const deleteSession = useDeleteSession();
	const snapshotSession = useSnapshotSession();

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
			await snapshotSession.mutateAsync(session.id);
			toast.success("Snapshot saved", { id: toastId });
		} catch {
			toast.error("Failed to save snapshot", { id: toastId });
		} finally {
			timeouts.forEach(clearTimeout);
		}
	};

	const snapshotAction =
		session.status === "running"
			? [
					{
						label: snapshotSession.isPending ? "Saving..." : "Save Snapshot",
						icon: <Camera className="h-4 w-4" />,
						onClick: handleSnapshot,
					},
				]
			: undefined;

	const handleDelete = async () => {
		await deleteSession.mutateAsync(session.id);
		if (isActive) {
			router.push("/dashboard");
		}
	};

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	const handleClick = () => {
		clearPendingPrompt();
		setActiveSession(session.id);
		router.push(`/dashboard/sessions/${session.id}`);
		onNavigate?.();
	};

	const handleRename = () => {
		setEditValue(session.title || "Untitled session");
		setIsEditing(true);
	};

	const handleSave = () => {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== session.title) {
			renameSession.mutate(session.id, trimmed);
		}
		setIsEditing(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSave();
		} else if (e.key === "Escape") {
			setIsEditing(false);
			setEditValue(session.title || "");
		}
	};

	const repoShortName = session.repo?.githubRepoName
		? getRepoShortName(session.repo.githubRepoName)
		: "unknown";
	const branchName = session.branchName || "";
	const displayTitle = session.title || `${repoShortName}${branchName ? ` (${branchName})` : ""}`;

	return (
		<>
			<div
				className={cn(
					"group relative flex items-center gap-[0.38rem] px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors",
					isActive
						? "bg-muted text-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-accent",
				)}
				onClick={handleClick}
			>
				{/* Name with optional running dot */}
				<div className="flex-1 min-w-0 flex items-center gap-1.5">
					{session.status === "running" && <StatusDot status="running" size="sm" />}
					{isEditing ? (
						<input
							ref={inputRef}
							type="text"
							value={editValue}
							onChange={(e) => setEditValue(e.target.value)}
							onBlur={handleSave}
							onKeyDown={handleKeyDown}
							onClick={(e) => e.stopPropagation()}
							className="w-full bg-transparent text-sm outline-none border-b border-primary"
						/>
					) : (
						<span className="truncate">{displayTitle}</span>
					)}
				</div>

				{/* Trailing: timestamp (default) or actions (on hover) */}
				<div className="shrink-0 flex items-center">
					<span className="text-xs text-muted-foreground/60 group-hover:hidden">
						{formatRelativeTime(session.lastActivityAt || session.startedAt || "")}
					</span>
					<div className="hidden group-hover:flex items-center">
						<ItemActionsMenu
							onRename={handleRename}
							onDelete={() => setDeleteDialogOpen(true)}
							customActions={snapshotAction}
							isVisible={isActive}
						/>
					</div>
				</div>
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Session</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this session. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
