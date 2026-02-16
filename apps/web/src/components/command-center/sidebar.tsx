"use client";

import { SearchTrigger } from "@/components/dashboard/command-search";
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
	Inbox,
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
import { useState } from "react";

/**
 * Command Center sidebar — management world only.
 * No session list / threads. Those live in the Studio sidebar.
 */

// Mobile sidebar trigger button
export function CCMobileSidebarTrigger() {
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

// Mobile sidebar drawer
export function CCMobileSidebar() {
	const { mobileSidebarOpen, setMobileSidebarOpen } = useDashboardStore();

	return (
		<Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
			<SheetContent side="left" className="w-full max-w-full p-0">
				<CCSidebarContent
					onNavigate={() => setMobileSidebarOpen(false)}
					onClose={() => setMobileSidebarOpen(false)}
				/>
			</SheetContent>
		</Sheet>
	);
}

// Desktop sidebar
export function CCSidebar() {
	const { sidebarCollapsed, toggleSidebar } = useDashboardStore();
	const pathname = usePathname();
	const router = useRouter();

	const isInboxPage = pathname?.startsWith("/dashboard/inbox");
	const isIntegrationsPage = pathname?.startsWith("/dashboard/integrations");
	const isAutomationsPage = pathname?.startsWith("/dashboard/automations");
	const isRepositoriesPage = pathname?.startsWith("/dashboard/repositories");

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
					title="New session"
				>
					<Plus className="h-4 w-4" />
				</Button>
				<Button
					variant={isInboxPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/inbox");
					}}
					title="Inbox"
				>
					<Inbox className="h-4 w-4" />
					{inboxCount > 0 && (
						<span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium flex items-center justify-center px-1">
							{inboxCount > 9 ? "9+" : inboxCount}
						</span>
					)}
				</Button>
				<Button
					variant={isRepositoriesPage ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						router.push("/dashboard/repositories");
					}}
					title="Repositories"
				>
					<FolderGit2 className="h-4 w-4" />
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

			{/* Full content */}
			<div
				className={cn(
					"w-64 flex flex-col h-full transition-opacity duration-200",
					sidebarCollapsed ? "opacity-0 pointer-events-none" : "opacity-100",
				)}
			>
				<CCSidebarContent showCollapseButton />
			</div>
		</aside>
	);
}

// Shared sidebar content — used by both desktop and mobile
function CCSidebarContent({
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

	const isInboxPage = pathname?.startsWith("/dashboard/inbox");
	const isAutomationsPage = pathname?.startsWith("/dashboard/automations");
	const isIntegrationsPage = pathname?.startsWith("/dashboard/integrations");
	const isRepositoriesPage = pathname?.startsWith("/dashboard/repositories");

	const inboxItems = useAttentionInbox({ wsApprovals: [] });
	const inboxCount = inboxItems.length;

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

			{/* New Session (navigates to /workspace) + Search */}
			<div className="px-2 mb-1 space-y-1">
				<button
					type="button"
					onClick={() => {
						router.push("/workspace");
						onNavigate?.();
					}}
					className="flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors font-medium"
				>
					<Plus className="h-5 w-5" />
					<span className="text-sm">New Session</span>
				</button>
				<SearchTrigger onClick={() => setCommandSearchOpen(true)} />
			</div>

			{/* Workspace section */}
			<div className="px-2 mb-1">
				<div className="px-3 py-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
					Workspace
				</div>
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/inbox")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isInboxPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<Inbox className="h-5 w-5" />
					<span>Inbox</span>
					{inboxCount > 0 && (
						<span className="ml-auto h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium flex items-center justify-center px-1.5">
							{inboxCount > 99 ? "99+" : inboxCount}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={() => handleNavigate("/dashboard/repositories")}
					className={cn(
						"flex items-center gap-[0.38rem] w-full px-3 py-1.5 rounded-lg text-sm transition-colors",
						isRepositoriesPage
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground hover:bg-accent",
					)}
				>
					<FolderGit2 className="h-5 w-5" />
					<span>Repositories</span>
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

			{/* Spacer — no threads section in Command Center */}
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

								{slackStatus?.connected && slackStatus?.supportChannel && (
									<>
										<div className="my-1 h-px bg-border" />
										<button
											type="button"
											className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left"
											onClick={() => {
												setSupportMenuOpen(false);
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
