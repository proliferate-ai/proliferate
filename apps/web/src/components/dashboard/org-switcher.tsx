"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { useAdmin } from "@/hooks/use-admin";
import { organization, useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import { Check, ChevronDown, Plus, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrgSwitcher() {
	const router = useRouter();
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: orgs, isPending: isOrgsPending } = useListOrganizations();
	const [isCreating, setIsCreating] = useState(false);
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const { impersonating, switchImpersonatedOrg, isSwitchingOrg } = useAdmin();

	// When impersonating, use the impersonated user's orgs and active org
	const effectiveOrgs = impersonating ? impersonating.userOrgs : orgs;
	const effectiveActiveOrg = impersonating ? impersonating.org : activeOrg;
	const isLoadingOrgs = impersonating ? false : isOrgsPending;

	const handleSwitchOrg = async (orgId: string) => {
		if (orgId === effectiveActiveOrg?.id) return;

		if (impersonating) {
			switchImpersonatedOrg({ orgId });
		} else {
			await organization.setActive({ organizationId: orgId });
			window.location.reload();
		}
	};

	const handleCreateOrg = async (name: string) => {
		setIsCreating(true);
		try {
			const slug = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "");

			await organization.create({
				name,
				slug: `${slug}-${Date.now().toString(36)}`,
			});
			setShowCreateDialog(false);
			window.location.reload();
		} catch (error) {
			console.error("Failed to create organization:", error);
			setErrorMessage("Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	};

	const handleOpenSettings = () => {
		router.push("/settings");
	};

	if (isActiveOrgPending && !impersonating) {
		return <span className="text-sm text-muted-foreground">Loading...</span>;
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						className="h-auto px-2 py-1 text-sm font-medium text-foreground hover:text-foreground max-w-full"
						disabled={isSwitchingOrg}
					>
						<span className="truncate">{effectiveActiveOrg?.name || "Select Organization"}</span>
						<ChevronDown className="ml-1 h-3 w-3 flex-shrink-0" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					<DropdownMenuLabel>Organizations</DropdownMenuLabel>
					<DropdownMenuSeparator />

					{isLoadingOrgs ? (
						<div className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</div>
					) : (
						effectiveOrgs?.map((org) => (
							<DropdownMenuItem
								key={org.id}
								onClick={() => handleSwitchOrg(org.id)}
								className="cursor-pointer"
							>
								<span className="flex-1 truncate">{org.name}</span>
								{org.id === effectiveActiveOrg?.id && <Check className="h-4 w-4 text-primary" />}
							</DropdownMenuItem>
						))
					)}

					{!impersonating && (
						<>
							<DropdownMenuSeparator />

							<DropdownMenuItem onClick={handleOpenSettings} className="cursor-pointer">
								<Settings className="mr-2 h-4 w-4" />
								Organization Settings
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<PromptDialog
				open={showCreateDialog}
				onOpenChange={setShowCreateDialog}
				title="Create Organization"
				description="Enter a name for your new organization."
				label="Organization name"
				placeholder="My Organization"
				confirmText={isCreating ? "Creating..." : "Create"}
				onConfirm={handleCreateOrg}
				isLoading={isCreating}
			/>

			<AlertDialog open={!!errorMessage} onOpenChange={() => setErrorMessage(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Error</AlertDialogTitle>
						<AlertDialogDescription>{errorMessage}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setErrorMessage(null)}>OK</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
