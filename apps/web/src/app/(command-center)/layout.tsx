"use client";

import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { BillingBanner } from "@/components/dashboard/billing-banner";
import { CommandSearch } from "@/components/dashboard/command-search";
import { MobileSidebar, MobileSidebarTrigger, Sidebar } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import { useBilling } from "@/hooks/use-billing";
import { useSession } from "@/lib/auth-client";
import { useDashboardStore } from "@/stores/dashboard";
import { env } from "@proliferate/environment/public";
import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

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
	const { commandSearchOpen, setCommandSearchOpen } = useDashboardStore();
	const needsOnboarding = billingEnabled && billingInfo?.state.billingState === "unconfigured";

	const isSettingsPage = pathname?.startsWith("/settings");

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

	// Keep onboarding/billing progression required, while allowing GitHub to be optional.
	useEffect(() => {
		if (!authPending && session && !billingLoading && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, billingLoading, needsOnboarding, router]);

	// Wait for required gate checks before rendering anything.
	// Billing error is treated as "still loading" (fail-closed) — TanStack Query
	// retries automatically, so the gate stays shut until we get a definitive answer.
	if (authPending || (billingEnabled && (billingLoading || billingError))) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	// Redirect in effect above; keep shell hidden while routing.
	if (needsOnboarding) {
		return null;
	}

	// Settings pages provide their own layout chrome — skip dashboard sidebar/banners
	if (isSettingsPage) {
		return <>{children}</>;
	}

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
				<main className="flex-1 overflow-y-auto animate-in fade-in duration-200">{children}</main>
			</div>

			{/* Mobile Sidebar Drawer */}
			<MobileSidebar />

			{/* Command Search */}
			<CommandSearch open={commandSearchOpen} onOpenChange={setCommandSearchOpen} />
		</div>
	);
}
