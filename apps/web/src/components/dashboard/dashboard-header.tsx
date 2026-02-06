"use client";

import { AdminPanel } from "@/components/admin/admin-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/hooks/use-admin";
import { useSignOut } from "@/hooks/use-sign-out";
import { useSession } from "@/lib/auth-client";
import { useDashboardStore } from "@/stores/dashboard";
import { PanelLeft, ShieldCheck } from "lucide-react";
import { useState } from "react";

export function DashboardHeader() {
	const { data: session } = useSession();
	const { sidebarCollapsed, toggleSidebar } = useDashboardStore();
	const handleSignOut = useSignOut();
	const { isSuperAdmin } = useAdmin();
	const [adminPanelOpen, setAdminPanelOpen] = useState(false);

	return (
		<header className="h-12 flex items-center justify-between px-4 border-b border-border bg-background">
			{/* Left section - only show sidebar toggle when collapsed */}
			<div className="flex items-center gap-3">
				{sidebarCollapsed && (
					<Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar}>
						<PanelLeft className="h-4 w-4" />
					</Button>
				)}
			</div>

			{/* Right section */}
			<div className="flex items-center gap-2">
				<span className="text-sm text-muted-foreground">
					{session?.user.name || session?.user.email}
				</span>
				{isSuperAdmin && (
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						onClick={() => setAdminPanelOpen(true)}
					>
						<ShieldCheck className="h-4 w-4" />
					</Button>
				)}
				<ThemeToggle />
				<Button variant="ghost" size="sm" onClick={handleSignOut}>
					Sign out
				</Button>
			</div>

			{/* Admin Panel */}
			<AdminPanel open={adminPanelOpen} onOpenChange={setAdminPanelOpen} />
		</header>
	);
}
