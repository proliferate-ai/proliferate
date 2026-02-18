"use client";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAdmin } from "@/hooks/use-admin";
import { organization, useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import { Building2, Check, ChevronsUpDown, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";

export function OrgSwitcher() {
	const router = useRouter();
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: orgs, isPending: isOrgsPending } = useListOrganizations();
	const { impersonating, switchImpersonatedOrg, isSwitchingOrg } = useAdmin();

	// When impersonating, use the impersonated user's orgs and active org
	const effectiveOrgs = impersonating ? impersonating.userOrgs : orgs;
	const effectiveActiveOrg = impersonating ? impersonating.org : activeOrg;
	const isLoadingOrgs = impersonating ? false : isOrgsPending;

	const orgInitial = effectiveActiveOrg?.name?.charAt(0).toUpperCase() || "W";

	const handleSwitchOrg = async (orgId: string) => {
		if (orgId === effectiveActiveOrg?.id) return;

		if (impersonating) {
			switchImpersonatedOrg({ orgId });
		} else {
			await organization.setActive({ organizationId: orgId });
			window.location.reload();
		}
	};

	if (isActiveOrgPending && !impersonating) {
		return (
			<div className="flex h-9 w-full items-center rounded-xl bg-card px-2 ring-1 ring-inset ring-border">
				<span className="text-sm text-muted-foreground">Loading...</span>
			</div>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={isSwitchingOrg}
					className="flex h-9 w-full items-center gap-2 rounded-xl bg-card px-2 ring-1 ring-inset ring-border shadow-subtle transition-colors hover:bg-accent"
				>
					<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
						<span className="text-xs font-bold">{orgInitial}</span>
					</div>
					<p className="flex-1 truncate text-left text-sm font-medium text-foreground">
						{effectiveActiveOrg?.name || "Workspace"}
					</p>
					<ChevronsUpDown className="mr-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64" sideOffset={4}>
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					Organizations
				</DropdownMenuLabel>

				{isLoadingOrgs ? (
					<div className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</div>
				) : (
					effectiveOrgs?.map((org) => (
						<DropdownMenuItem
							key={org.id}
							onClick={() => handleSwitchOrg(org.id)}
							className="cursor-pointer"
						>
							{(org as { is_personal?: boolean }).is_personal ? (
								<User className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
							) : (
								<Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
							)}
							<span className="flex-1 truncate">{org.name}</span>
							{(org as { is_personal?: boolean }).is_personal && (
								<span className="ml-2 text-xs text-muted-foreground">Personal</span>
							)}
							{org.id === effectiveActiveOrg?.id && (
								<Check className="ml-2 h-4 w-4 shrink-0 text-foreground" />
							)}
						</DropdownMenuItem>
					))
				)}

				{!impersonating && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
							<Settings className="mr-2 h-4 w-4 text-muted-foreground" />
							Organization settings
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
