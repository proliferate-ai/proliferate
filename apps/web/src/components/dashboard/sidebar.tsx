"use client";

import { openIntercomMessenger } from "@/components/providers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarCollapseIcon, SidebarExpandIcon, SlackIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { useSlackStatus } from "@/hooks/use-integrations";
import { useSignOut } from "@/hooks/use-sign-out";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import {
	FileStackIcon,
	FolderGit2,
	Home,
	Inbox,
	LifeBuoy,
	LogOut,
	Menu,
	MessageCircle,
	MessageSquare,
	Moon,
	Plug,
	Settings,
	Sun,
	Terminal,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { SearchTrigger } from "./command-search";

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
	const pathname = usePathname();
	const router = useRouter();

	const isHomePage = pathname === "/dashboard";
	const isRunsPage = pathname?.startsWith("/dashboard/runs");
	const isSessionsPage = pathname?.startsWith("/dashboard/sessions");
	const isIntegrationsPage = pathname?.startsWith("/dashboard/integrations");
	const isAutomationsPage = pathname?.startsWith("/dashboard/automations");
	const isReposPage = pathname?.startsWith("/dashboard/repos");

	const inboxItems = useAttentionInbox({ wsApprovals: [] });
	const inboxCount = inboxItems.length;

	return (
		<aside
			className={cn(
				"hidden md:flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden",
				"transition-[width] duration-200 ease-out",
				sidebarCollapsed ? "w-12 cursor-pointer hover:bg-accent/50 transition-colors" : "w-64",
			)}
			onClick={sidebarCollapsed ? toggleSidebar : undefined}
		>
			{/* Collapsed view — icon-only nav */}
			<div
				className={cn(
					"flex flex-col items-center h-full py-2 gap-1 transition-opacity duration-150",
					sidebarCollapsed ? "opacity-100" : "opacity-0 pointer-events-none absolute inset-0",
				)}
			>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						toggleSidebar();
					}}
					title="Expand sidebar"
				>
					<SidebarExpandIcon className="h-4 w-4" />
				</Button>
				<div className="my-1" />
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/workspace");
					}}
					title="Open workspace"
				>
					<Terminal className="h-4 w-4" />
				</Button>
				<Button
					variant={isHomePage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard");
					}}
					title="Home"
				>
					<Home className="h-4 w-4" />
				</Button>
				<Button
					variant={isRunsPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/runs");
					}}
					title="Runs"
				>
					<Inbox className="h-4 w-4" />
					{inboxCount > 0 && (
						<span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium flex items-center justify-center px-1">
							{inboxCount > 9 ? "9+" : inboxCount}
						</span>
					)}
				</Button>
				<Button
					variant={isSessionsPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/sessions");
					}}
					title="Sessions"
				>
					<MessageSquare className="h-4 w-4" />
				</Button>
				<div className="my-1" />
				<Button
					variant={isAutomationsPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/automations");
					}}
					title="Automations"
				>
					<FileStackIcon className="h-4 w-4" />
				</Button>
				<Button
					variant={isReposPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/repos");
					}}
					title="Repos"
				>
					<FolderGit2 className="h-4 w-4" />
				</Button>
				<Button
					variant={isIntegrationsPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/integrations");
					}}
					title="Integrations"
				>
					<Plug className="h-4 w-4" />
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
	const { toggleSidebar, setCommandSearchOpen } = useDashboardStore();

	const user = authSession?.user;
	const userInitials = user?.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: user?.email?.[0]?.toUpperCase() || "?";

	// Detect active pages from URL
	const isHomePage = pathname === "/dashboard";
	const isRunsPage = pathname?.startsWith("/dashboard/runs");
	const isSessionsPage = pathname?.startsWith("/dashboard/sessions");
	const isAutomationsPage = pathname?.startsWith("/dashboard/automations");
	const isIntegrationsPage = pathname?.startsWith("/dashboard/integrations");
	const isReposPage = pathname?.startsWith("/dashboard/repos");

	// Inbox count for badge
	const inboxItems = useAttentionInbox({ wsApprovals: [] });
	const inboxCount = inboxItems.length;

	const handleNavigate = (path: string) => {
		router.push(path);
		onNavigate?.();
	};

	return (
		<>
			{/* Top section: Logo + Terminal + Collapse/Close */}
			<div className="p-3 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<img
						src={
							resolvedTheme === "dark"
								? "https://d1uh4o7rpdqkkl.cloudfront.net/logotype-inverted.webp"
								: "https://d1uh4o7rpdqkkl.cloudfront.net/logotype.webp"
						}
						alt="Proliferate"
						className="h-5"
					/>
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-muted-foreground hover:text-foreground"
						onClick={() => handleNavigate("/workspace")}
						title="Open workspace"
					>
						<Terminal className="h-4 w-4" />
					</Button>
				</div>
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

			{/* Search */}
			<div className="px-2 mb-1">
				<SearchTrigger onClick={() => setCommandSearchOpen(true)} />
			</div>

			{/* Main nav */}
			<div className="px-2 mb-1">
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isHomePage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<Home className="h-5 w-5" />
					<span>Home</span>
				</button>
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/runs")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isRunsPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<Inbox className="h-5 w-5" />
					<span>Runs</span>
					{inboxCount > 0 && (
						<span className="ml-auto h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium flex items-center justify-center px-1.5">
							{inboxCount > 99 ? "99+" : inboxCount}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/sessions")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isSessionsPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<MessageSquare className="h-5 w-5" />
					<span>Sessions</span>
				</button>
			</div>

			{/* Agents section */}
			<div className="px-2 mb-2">
				<div className="px-3 py-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
					Agents
				</div>
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
					<FileStackIcon className="h-5 w-5" />
					<span>Automations</span>
				</button>
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/repos")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isReposPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<FolderGit2 className="h-5 w-5" />
					<span>Repos</span>
				</button>
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
			</div>

			{/* Spacer to push footer down */}
			<div className="flex-1" />

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

								{/* Slack Connect - only show when fully set up */}
								{slackStatus?.connected && slackStatus?.supportChannel && (
									<>
										<div className="my-1 h-px bg-border" />

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
									</>
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
