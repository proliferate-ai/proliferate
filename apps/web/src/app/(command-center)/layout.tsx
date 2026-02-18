"use client";

import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { BillingBanner } from "@/components/dashboard/billing-banner";
import { CommandSearch } from "@/components/dashboard/command-search";
import { MobileSidebar, MobileSidebarTrigger, Sidebar } from "@/components/dashboard/sidebar";
import { openIntercomMessenger } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { useBilling } from "@/hooks/use-billing";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useSession } from "@/lib/auth-client";
import { useDashboardStore } from "@/stores/dashboard";
import { env } from "@proliferate/environment/public";
import { BookOpen, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const PAGE_TITLES: Record<string, string> = {
	"/dashboard": "Home",
	"/dashboard/inbox": "Inbox",
	"/dashboard/sessions": "Sessions",
	"/dashboard/automations": "Automations",
	"/dashboard/repos": "Repos",
	"/dashboard/integrations": "Integrations",
	"/dashboard/actions": "Actions",
	"/dashboard/triggers": "Triggers",
	"/settings": "Settings",
	"/settings/profile": "Profile",
	"/settings/general": "General",
	"/settings/members": "Members",
	"/settings/secrets": "Secrets",
	"/settings/billing": "Billing",
	"/settings/connections": "Connections",
	"/settings/repositories": "Repositories",
	"/settings/tools": "Tools",
};

function getPageTitle(pathname: string): string {
	if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
	// For detail pages like /dashboard/automations/[id], use the parent title
	for (const [path, title] of Object.entries(PAGE_TITLES)) {
		if (pathname.startsWith(`${path}/`)) return title;
	}
	return "";
}

export default function CommandCenterLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const { data: session, isPending: authPending } = useSession();
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const { data: billingInfo, isLoading: billingLoading, isError: billingError } = useBilling();
	const { data: onboardingStatus, isLoading: onboardingLoading } = useOnboarding();
	const { commandSearchOpen, setCommandSearchOpen } = useDashboardStore();
	const needsOnboarding = onboardingStatus ? !onboardingStatus.onboardingComplete : false;

	// Cmd+K keyboard shortcut for search
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setCommandSearchOpen(true);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [setCommandSearchOpen]);

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Redirect to verify-email if email not verified (when verification is required)
	const requireEmailVerification = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;
	useEffect(() => {
		if (!authPending && session && requireEmailVerification && !session.user?.emailVerified) {
			router.push("/auth/verify-email");
		}
	}, [session, authPending, router, requireEmailVerification]);

	// Keep onboarding progression required, while allowing GitHub to be optional.
	useEffect(() => {
		if (!authPending && session && !onboardingLoading && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, onboardingLoading, needsOnboarding, router]);

	// Wait for required gate checks before rendering anything.
	// Billing error is treated as "still loading" (fail-closed) — TanStack Query
	// retries automatically, so the gate stays shut until we get a definitive answer.
	if (authPending || onboardingLoading || (billingEnabled && (billingLoading || billingError))) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	// Redirect in effect above; keep shell hidden while routing.
	if (needsOnboarding) {
		return null;
	}

	const pageTitle = getPageTitle(pathname);

	return (
		<div className="h-screen flex flex-col bg-background">
			{/* Impersonation Banner - spans full width at top when impersonating */}
			<ImpersonationBanner />

			{/* Billing Banner - shows when credits low or trial state */}
			<BillingBanner />

			{/* Mobile header - only visible on mobile */}
			<div className="flex md:hidden items-center justify-between h-14 px-4 border-b border-border shrink-0">
				<MobileSidebarTrigger />
				<Button
					variant="ghost"
					size="icon"
					className="h-9 w-9"
					onClick={() => setCommandSearchOpen(true)}
				>
					<Search className="h-5 w-5" />
					<span className="sr-only">Search</span>
				</Button>
			</div>

			{/* Main layout: Sidebar + Content */}
			<div className="flex-1 flex overflow-hidden">
				{/* Sidebar - desktop only, full height */}
				<Sidebar />

				{/* Main content */}
				<div className="flex-1 flex flex-col overflow-hidden">
					{/* Desktop header bar */}
					<div className="hidden md:flex shrink-0 items-center justify-between h-12 px-4 border-b border-border/50">
						<h1 className="text-sm font-medium text-foreground truncate">{pageTitle}</h1>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="h-8 gap-1.5 text-muted-foreground"
								asChild
							>
								<Link href="https://docs.proliferate.com" target="_blank" rel="noopener noreferrer">
									<BookOpen className="h-3.5 w-3.5" />
									<span className="text-xs">Docs</span>
								</Link>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-8 gap-1.5 text-muted-foreground"
								onClick={openIntercomMessenger}
							>
								<MessageSquare className="h-3.5 w-3.5" />
								<span className="text-xs">Feedback</span>
							</Button>
						</div>
					</div>

					<main className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-200">
						{children}
					</main>
				</div>
			</div>

			{/* Mobile Sidebar Drawer */}
			<MobileSidebar />

			{/* Command Search */}
			<CommandSearch open={commandSearchOpen} onOpenChange={setCommandSearchOpen} />
		</div>
	);
}
