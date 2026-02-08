"use client";

import { Button } from "@/components/ui/button";
import { SelectableItem } from "@/components/ui/selectable-item";
import { useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import { organization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { env } from "@proliferate/environment/public";
import {
	ArrowLeft,
	Building2,
	CreditCard,
	ExternalLink,
	Key,
	Search,
	User,
	Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const BILLING_ENABLED = env.NEXT_PUBLIC_BILLING_ENABLED;

const NAV_ITEMS = [
	{
		section: "Account",
		items: [{ id: "profile", label: "Profile", icon: User, href: "/settings/profile" }],
	},
	{
		section: "Workspace",
		items: [
			{ id: "general", label: "General", icon: Building2, href: "/settings/general" },
			...(BILLING_ENABLED
				? [{ id: "billing", label: "Billing", icon: CreditCard, href: "/settings/billing" }]
				: []),
			{ id: "members", label: "Members", icon: Users, href: "/settings/members" },
			{ id: "secrets", label: "Secrets", icon: Key, href: "/settings/secrets" },
		],
	},
];

const PAGE_TITLES: Record<string, string> = {
	profile: "Profile",
	general: "General",
	members: "Members",
	secrets: "Secrets",
	...(BILLING_ENABLED ? { billing: "Billing" } : {}),
};

function getPageTitle(pathname: string) {
	const segment = pathname.split("/").pop() || "profile";
	return PAGE_TITLES[segment] || "Settings";
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const title = getPageTitle(pathname);
	const { data: activeOrg } = useActiveOrganization();
	const { data: orgs } = useListOrganizations();

	const handleSwitchOrg = async (orgId: string) => {
		if (orgId === activeOrg?.id) return;
		await organization.setActive({ organizationId: orgId });
		window.location.reload();
	};

	return (
		<div className="min-h-screen bg-sidebar flex">
			{/* Sidebar */}
			<aside className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 border-r border-sidebar-border bg-sidebar z-20">
				{/* Back button */}
				<div className="p-2">
					<Link href="/dashboard">
						<Button
							variant="ghost"
							size="sm"
							className="gap-2 text-muted-foreground hover:text-foreground h-8"
						>
							<ArrowLeft className="h-4 w-4" />
							Back
						</Button>
					</Link>
				</div>

				{/* Navigation */}
				<nav className="flex-1 overflow-y-auto px-2 py-1">
					{NAV_ITEMS.map((section) => (
						<div key={section.section} className="mb-4">
							<p className="px-3 py-1.5 text-xs text-muted-foreground">{section.section}</p>
							<ul className="space-y-0.5">
								{section.items.map((item) => {
									const isActive = pathname === item.href;
									return (
										<li key={item.id}>
											<Link
												href={item.href}
												className={cn(
													"flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors",
													isActive
														? "bg-muted/80 text-foreground"
														: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
												)}
											>
												<item.icon className="h-4 w-4" />
												{item.label}
											</Link>
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</nav>

				{/* Organization Switcher */}
				{orgs && orgs.length > 0 && (
					<div className="border-t border-sidebar-border p-2">
						<p className="px-3 py-1.5 text-xs text-muted-foreground">Workspace</p>
						<div className="space-y-0.5">
							{orgs.map((org) => (
								<SelectableItem
									key={org.id}
									selected={org.id === activeOrg?.id}
									onClick={() => handleSwitchOrg(org.id)}
									icon={
										<div
											className={cn(
												"h-1.5 w-1.5 rounded-full",
												org.id === activeOrg?.id ? "bg-primary" : "bg-muted-foreground/40",
											)}
										/>
									}
									className="py-1.5"
								>
									<span className="block truncate">{org.name}</span>
								</SelectableItem>
							))}
						</div>
					</div>
				)}
			</aside>

			{/* Main area */}
			<div className="flex-1 md:ml-64 flex flex-col min-h-screen bg-sidebar">
				{/* Top bar */}
				<header className="sticky top-0 z-10 flex items-center justify-between h-12 px-6 border-b border-border">
					<span className="text-sm font-medium text-foreground">{title}</span>
					<div className="flex items-center gap-3">
						<Button
							variant="outline"
							size="sm"
							className="h-auto px-2.5 py-1 text-xs text-muted-foreground"
						>
							<Search className="h-3.5 w-3.5 mr-2" />
							<span>Search...</span>
							<kbd className="ml-2 text-[10px] px-1 py-0.5 rounded border border-border">⌘K</kbd>
						</Button>
						<a
							href="https://docs.proliferate.com"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							Docs
							<ExternalLink className="h-3.5 w-3.5" />
						</a>
					</div>
				</header>

				{/* Content */}
				<main className="flex-1 overflow-auto">
					<div
						key={pathname}
						className="mx-auto max-w-[40rem] px-8 py-6 animate-in fade-in duration-200"
					>
						{children}
					</div>
				</main>
			</div>
		</div>
	);
}
