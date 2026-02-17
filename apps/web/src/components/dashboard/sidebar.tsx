"use client";

import { openIntercomMessenger } from "@/components/providers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	AutomationsIcon,
	RunsIcon,
	SidebarCollapseIcon,
	SidebarExpandIcon,
	SlackIcon,
} from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { useSlackStatus } from "@/hooks/use-integrations";
import { useSessions } from "@/hooks/use-sessions";
import { useSignOut } from "@/hooks/use-sign-out";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard";
import { env } from "@proliferate/environment/public";
import {
	ArrowLeft,
	Building2,
	ChevronsUpDown,
	CreditCard,
	FolderGit2,
	Home,
	Key,
	LifeBuoy,
	LogOut,
	Menu,
	MessageCircle,
	MessageSquare,
	Moon,
	Plug,
	Settings,
	Sun,
	User,
	Users,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
	const pathname = usePathname();
	const isSettingsPage = pathname?.startsWith("/settings");

	return (
		<Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
			<SheetContent side="left" className="w-full max-w-full p-0">
				<SidebarShell
					onNavigate={() => setMobileSidebarOpen(false)}
					onClose={() => setMobileSidebarOpen(false)}
				>
					{isSettingsPage ? (
						<SettingsNav onNavigate={() => setMobileSidebarOpen(false)} />
					) : (
						<DashboardNav onNavigate={() => setMobileSidebarOpen(false)} />
					)}
				</SidebarShell>
			</SheetContent>
		</Sheet>
	);
}

// Desktop sidebar - hidden on mobile
export function Sidebar() {
	const { sidebarCollapsed, toggleSidebar, setActiveSession } = useDashboardStore();
	const pathname = usePathname();
	const router = useRouter();

	const isSettingsPage = pathname?.startsWith("/settings");
	const isHomePage = pathname === "/dashboard";
	const isRunsPage = pathname?.startsWith("/dashboard/runs");
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
						setActiveSession(null);
						router.push("/dashboard");
					}}
					title="New chat"
				>
					<img
						src="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp"
						alt="Proliferate"
						className="h-4 w-4 rounded-full"
					/>
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
					<RunsIcon className="h-4 w-4" />
					{inboxCount > 0 && (
						<span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium flex items-center justify-center px-1">
							{inboxCount > 9 ? "9+" : inboxCount}
						</span>
					)}
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
					<AutomationsIcon className="h-4 w-4" />
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
				<SidebarShell showCollapseButton>
					{isSettingsPage ? <SettingsNav /> : <DashboardNav />}
				</SidebarShell>
			</div>
		</aside>
	);
}

// --- Exported building blocks for reuse (e.g. settings sidebar) ---

export function NavItem({
	icon: Icon,
	label,
	active,
	badge,
	onClick,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	active: boolean;
	badge?: number;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-2 w-full px-2 h-8 rounded-xl text-sm font-medium transition-colors",
				active
					? "bg-foreground/[0.05] text-foreground"
					: "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]",
			)}
		>
			<Icon className="h-5 w-5 shrink-0" />
			<span className="truncate">{label}</span>
			{badge !== undefined && badge > 0 && (
				<span className="ml-auto h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-medium flex items-center justify-center px-1.5 shrink-0">
					{badge > 99 ? "99+" : badge}
				</span>
			)}
		</button>
	);
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
	return <h2 className="px-2 text-sm font-medium text-muted-foreground">{children}</h2>;
}

// Shared sidebar shell — header (logo + search) + nav area (children) + footer (support + user card)
export function SidebarShell({
	children,
	onNavigate,
	onClose,
	showCollapseButton = false,
}: {
	children: React.ReactNode;
	onNavigate?: () => void;
	onClose?: () => void;
	showCollapseButton?: boolean;
}) {
	const router = useRouter();
	const handleSignOut = useSignOut();
	const { data: authSession } = useSession();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const [userMenuOpen, setUserMenuOpen] = useState(false);
	const [supportMenuOpen, setSupportMenuOpen] = useState(false);
	const [launcherOpen, setLauncherOpen] = useState(false);

	// Fetch Slack status for support popup
	const { data: slackStatus } = useSlackStatus();
	const { toggleSidebar, setCommandSearchOpen, setActiveSession } = useDashboardStore();

	const user = authSession?.user;
	const userInitials = user?.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: user?.email?.[0]?.toUpperCase() || "?";

	const handleNavigate = (path: string) => {
		router.push(path);
		onNavigate?.();
	};

	return (
		<>
			{/* Header: Logo + actions */}
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

			{/* New chat launcher */}
			<div className="px-3 mb-2">
				<Popover open={launcherOpen} onOpenChange={setLauncherOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="flex items-center gap-2 w-full bg-card rounded-xl px-2 h-9 ring-1 ring-inset ring-border shadow-subtle transition-colors hover:bg-accent"
						>
							<div className="w-5 h-5 flex items-center justify-center rounded-md bg-foreground/[0.04] border border-foreground/[0.1]">
								<img
									src="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp"
									alt="Proliferate"
									className="w-3 h-3 rounded-full"
								/>
							</div>
							<p className="text-sm font-medium text-foreground truncate flex-1 text-left">
								Workspace
							</p>
							<ChevronsUpDown className="h-4 w-4 text-muted-foreground mr-0.5 shrink-0" />
						</button>
					</PopoverTrigger>
					<PopoverContent
						side="bottom"
						align="start"
						className="w-[min(16rem,calc(100vw-2rem))] p-1.5 bg-popover/90 backdrop-blur rounded-[10px] z-[60]"
						sideOffset={6}
					>
						<button
							type="button"
							className="flex items-center gap-3 w-full px-3 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left"
							onClick={() => {
								setLauncherOpen(false);
								setActiveSession(null);
								handleNavigate("/dashboard");
							}}
						>
							<div className="h-8 w-8 rounded-[10px] border border-border/60 bg-muted/50 flex items-center justify-center shrink-0">
								<img
									src="https://d1uh4o7rpdqkkl.cloudfront.net/logo.webp"
									alt="Proliferate"
									className="h-4 w-4 rounded-full"
								/>
							</div>
							<div className="flex-1 min-w-0">
								<div className="font-medium text-foreground">Open workspace</div>
								<div className="text-xs text-muted-foreground">Start a new chat session</div>
							</div>
						</button>
					</PopoverContent>
				</Popover>
			</div>

			{/* Search */}
			<div className="px-3 mb-2">
				<SearchTrigger onClick={() => setCommandSearchOpen(true)} />
			</div>

			{/* Scrollable nav — content provided by caller */}
			<nav className="flex-1 overflow-y-auto overflow-x-hidden px-3">
				<div className="flex flex-col gap-5">{children}</div>
			</nav>

			{/* Footer */}
			<div className="border-t border-sidebar-border px-3 py-3 flex flex-col gap-2">
				{/* Support */}
				<Popover open={supportMenuOpen} onOpenChange={setSupportMenuOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="flex items-center justify-center gap-2 w-full h-8 rounded-lg text-sm font-medium border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border transition-colors"
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

				{/* User card */}
				<Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="flex items-center gap-3 w-full p-2 rounded-xl bg-muted/30 hover:bg-muted transition-all text-left"
						>
							<Avatar className="h-7 w-7">
								<AvatarImage src={user?.image || undefined} alt={user?.name || "User"} />
								<AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
							</Avatar>
							<div className="flex-1 min-w-0">
								<Text variant="small" className="font-medium truncate block text-xs">
									{user?.name || "User"}
								</Text>
								<Text variant="small" color="muted" className="text-[11px] truncate block">
									{user?.email || ""}
								</Text>
							</div>
						</button>
					</PopoverTrigger>
					<PopoverContent side="top" align="end" className="w-56 p-1 z-[60]" sideOffset={8}>
						<div className="flex flex-col">
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
		</>
	);
}

// Helper to extract short repo name from "org/repo" format
function getRepoShortName(fullName: string): string {
	const parts = fullName.split("/");
	return parts[parts.length - 1];
}

// Dashboard-specific nav items
function DashboardNav({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	const router = useRouter();

	const isHomePage = pathname === "/dashboard";
	const isRunsPage = pathname?.startsWith("/dashboard/runs");
	const isAutomationsPage = pathname?.startsWith("/dashboard/automations");
	const isIntegrationsPage = pathname?.startsWith("/dashboard/integrations");
	const isReposPage = pathname?.startsWith("/dashboard/repos");
	const isSettingsPage = pathname?.startsWith("/settings");

	const inboxItems = useAttentionInbox({ wsApprovals: [] });
	const inboxCount = inboxItems.length;

	const { data: sessions } = useSessions();
	const recentSessions = useMemo(() => {
		if (!sessions) return [];
		return sessions.filter((s) => s.sessionType !== "setup" && s.origin !== "cli").slice(0, 5);
	}, [sessions]);

	const handleNavigate = (path: string) => {
		router.push(path);
		onNavigate?.();
	};

	return (
		<>
			{/* Top-level nav */}
			<div className="flex flex-col gap-1">
				<NavItem
					icon={Home}
					label="Home"
					active={!!isHomePage}
					onClick={() => handleNavigate("/dashboard")}
				/>
			</div>

			{/* Monitor */}
			<div className="flex flex-col gap-1">
				<SectionLabel>Monitor</SectionLabel>
				<NavItem
					icon={RunsIcon}
					label="Runs"
					active={!!isRunsPage}
					badge={inboxCount}
					onClick={() => handleNavigate("/dashboard/runs")}
				/>
			</div>

			{/* Configure */}
			<div className="flex flex-col gap-1">
				<SectionLabel>Configure</SectionLabel>
				<NavItem
					icon={AutomationsIcon}
					label="Automations"
					active={!!isAutomationsPage}
					onClick={() => handleNavigate("/dashboard/automations")}
				/>
				<NavItem
					icon={FolderGit2}
					label="Repos"
					active={!!isReposPage}
					onClick={() => handleNavigate("/dashboard/repos")}
				/>
				<NavItem
					icon={Plug}
					label="Integrations"
					active={!!isIntegrationsPage}
					onClick={() => handleNavigate("/dashboard/integrations")}
				/>
			</div>

			{/* Recents */}
			{recentSessions.length > 0 && (
				<div className="flex flex-col gap-0.5">
					<SectionLabel>Recents</SectionLabel>
					{recentSessions.map((session) => {
						const repoName = session.repo?.githubRepoName
							? getRepoShortName(session.repo.githubRepoName)
							: null;
						const title = session.title || repoName || "Untitled session";

						return (
							<button
								key={session.id}
								type="button"
								onClick={() => handleNavigate(`/workspace/${session.id}`)}
								className="flex items-center gap-2 w-full px-2 h-7 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
							>
								<MessageSquare className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{title}</span>
							</button>
						);
					})}
					<button
						type="button"
						onClick={() => handleNavigate("/dashboard/sessions")}
						className="flex items-center gap-2 w-full px-2 h-7 rounded-lg text-xs transition-colors text-muted-foreground/70 hover:text-muted-foreground"
					>
						<span className="ml-5.5">View all</span>
					</button>
				</div>
			)}

			{/* Settings */}
			<div className="flex flex-col gap-1">
				<NavItem
					icon={Settings}
					label="Settings"
					active={!!isSettingsPage}
					onClick={() => handleNavigate("/settings/profile")}
				/>
			</div>
		</>
	);
}

const BILLING_ENABLED = env.NEXT_PUBLIC_BILLING_ENABLED;

// Settings-specific nav items
function SettingsNav({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	const router = useRouter();

	const isProfilePage = pathname === "/settings/profile";
	const isGeneralPage = pathname === "/settings/general";
	const isMembersPage = pathname === "/settings/members";
	const isSecretsPage = pathname === "/settings/secrets";
	const isBillingPage = pathname === "/settings/billing";

	const handleNavigate = (path: string) => {
		router.push(path);
		onNavigate?.();
	};

	return (
		<>
			{/* Back to dashboard */}
			<div className="flex flex-col gap-1">
				<NavItem
					icon={ArrowLeft}
					label="Back"
					active={false}
					onClick={() => handleNavigate("/dashboard")}
				/>
			</div>

			{/* Account */}
			<div className="flex flex-col gap-1">
				<SectionLabel>Account</SectionLabel>
				<NavItem
					icon={User}
					label="Profile"
					active={!!isProfilePage}
					onClick={() => handleNavigate("/settings/profile")}
				/>
			</div>

			{/* Workspace */}
			<div className="flex flex-col gap-1">
				<SectionLabel>Workspace</SectionLabel>
				<NavItem
					icon={Building2}
					label="General"
					active={!!isGeneralPage}
					onClick={() => handleNavigate("/settings/general")}
				/>
				<NavItem
					icon={Users}
					label="Members"
					active={!!isMembersPage}
					onClick={() => handleNavigate("/settings/members")}
				/>
				<NavItem
					icon={Key}
					label="Secrets"
					active={!!isSecretsPage}
					onClick={() => handleNavigate("/settings/secrets")}
				/>
				{BILLING_ENABLED && (
					<NavItem
						icon={CreditCard}
						label="Billing"
						active={!!isBillingPage}
						onClick={() => handleNavigate("/settings/billing")}
					/>
				)}
			</div>
		</>
	);
}
