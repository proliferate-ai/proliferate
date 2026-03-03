"use client";

import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { BillingBanner } from "@/components/dashboard/billing-banner";
import { CommandSearch } from "@/components/dashboard/command-search";
import { DesktopHeader } from "@/components/dashboard/desktop-header";
import { MobileSidebar, MobileSidebarTrigger, Sidebar } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import { getPageTitle } from "@/config/navigation";
import { useCommandSearch } from "@/hooks/ui/use-command-search";
import { useLayoutGate } from "@/hooks/ui/use-layout-gate";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";

export default function CommandCenterLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { ready, session } = useLayoutGate({ requireOnboarding: true });
	const pathname = usePathname();
	const { open: commandSearchOpen, setOpen: setCommandSearchOpen } = useCommandSearch();

	if (!ready) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	return (
		<div className="h-screen flex flex-col bg-background">
			<ImpersonationBanner />
			<BillingBanner />

			{/* Mobile header */}
			<div className="flex md:hidden items-center justify-between h-14 px-4 border-b border-border shrink-0">
				<MobileSidebarTrigger />
				<Button
					variant="ghost"
					size="icon"
					className="h-9 w-9 rounded-lg"
					onClick={() => setCommandSearchOpen(true)}
				>
					<Search className="h-5 w-5" />
					<span className="sr-only">Search</span>
				</Button>
			</div>

			<div className="flex-1 flex overflow-hidden">
				<Sidebar />

				<div className="flex-1 flex flex-col overflow-hidden">
					<DesktopHeader pageTitle={getPageTitle(pathname)} />

					<main className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-200">
						{children}
					</main>
				</div>
			</div>

			<MobileSidebar />
			<CommandSearch open={commandSearchOpen} onOpenChange={setCommandSearchOpen} />
		</div>
	);
}
