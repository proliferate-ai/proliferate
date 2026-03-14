"use client";

import { DesktopHeader } from "@/components/dashboard/desktop-header";
import { MobileSidebar, MobileSidebarTrigger, Sidebar } from "@/components/dashboard/sidebar";
import { useLayoutGate } from "@/hooks/ui/use-layout-gate";
import { getPageTitle } from "@/lib/display/navigation";
import { usePathname } from "next/navigation";

export default function CommandCenterLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { ready, session } = useLayoutGate({ requireOnboarding: true });
	const pathname = usePathname();

	if (!ready) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	return (
		<div className="h-screen flex flex-col bg-background">
			{/* Mobile header */}
			<div className="flex md:hidden items-center justify-between h-14 px-4 border-b border-border shrink-0">
				<MobileSidebarTrigger />
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
		</div>
	);
}
