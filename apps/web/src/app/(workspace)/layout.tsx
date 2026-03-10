"use client";

import { CommandSearch } from "@/components/dashboard/command-search";
import { MobileSidebar, MobileSidebarTrigger, Sidebar } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import { useCommandSearch } from "@/hooks/ui/use-command-search";
import { useLayoutGate } from "@/hooks/ui/use-layout-gate";
import { Search } from "lucide-react";
import { usePathname } from "next/navigation";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
	const { ready, session } = useLayoutGate();
	const { open: commandSearchOpen, setOpen: setCommandSearchOpen } = useCommandSearch();
	const pathname = usePathname();
	const showSidebar = !pathname?.startsWith("/workspace/onboard");

	if (!ready) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	if (!showSidebar) {
		return <div className="h-dvh flex flex-col">{children}</div>;
	}

	return (
		<div className="h-dvh flex flex-col">
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
				<div className="flex-1 flex flex-col overflow-hidden">{children}</div>
			</div>

			<MobileSidebar />
			<CommandSearch open={commandSearchOpen} onOpenChange={setCommandSearchOpen} />
		</div>
	);
}
