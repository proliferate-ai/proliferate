"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdmin, useAdminOrganizations, useAdminUsers } from "@/hooks/use-admin";
import { Building, Loader2, User, UserCheck } from "lucide-react";
import { useState } from "react";

interface AdminPanelProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function AdminPanel({ open, onOpenChange }: AdminPanelProps) {
	const [searchFilter, setSearchFilter] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
	const { impersonate, isImpersonating } = useAdmin();
	const { data: users, isLoading: isLoadingUsers } = useAdminUsers();
	const { data: organizations, isLoading: isLoadingOrgs } = useAdminOrganizations();

	const filteredUsers = users?.filter(
		(user) =>
			user.name?.toLowerCase().includes(searchFilter.toLowerCase()) ||
			user.email?.toLowerCase().includes(searchFilter.toLowerCase()),
	);

	const filteredOrgs = organizations?.filter(
		(org) =>
			org.name?.toLowerCase().includes(searchFilter.toLowerCase()) ||
			org.slug?.toLowerCase().includes(searchFilter.toLowerCase()),
	);

	const handleImpersonate = (userId: string, orgId: string) => {
		setSelectedUserId(userId);
		impersonate(
			{ userId, orgId },
			{
				onSettled: () => setSelectedUserId(null),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>Admin Panel</DialogTitle>
					<DialogDescription>
						View all users and organizations. Impersonate users to debug issues.
					</DialogDescription>
				</DialogHeader>

				<Input
					placeholder="Search users or organizations..."
					value={searchFilter}
					onChange={(e) => setSearchFilter(e.target.value)}
					className="mb-4"
				/>

				<Tabs defaultValue="users" className="flex-1 overflow-hidden flex flex-col">
					<TabsList className="w-full justify-start">
						<TabsTrigger value="users" className="gap-2">
							<User className="h-4 w-4" />
							Users
						</TabsTrigger>
						<TabsTrigger value="organizations" className="gap-2">
							<Building className="h-4 w-4" />
							Organizations
						</TabsTrigger>
					</TabsList>

					<TabsContent value="users" className="flex-1 overflow-auto mt-4">
						{isLoadingUsers ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : filteredUsers?.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">No users found</div>
						) : (
							<div className="space-y-2">
								{filteredUsers?.map((user) => (
									<div
										key={user.id}
										className="flex items-center justify-between p-3 rounded-lg border bg-card"
									>
										<div className="flex-1 min-w-0">
											<div className="font-medium truncate">{user.name || "No name"}</div>
											<div className="text-sm text-muted-foreground truncate">{user.email}</div>
											{user.member && user.member.length > 0 && (
												<div className="text-xs text-muted-foreground mt-1">
													{user.member
														.map((m) => m.organization?.name)
														.filter(Boolean)
														.join(", ")}
												</div>
											)}
										</div>
										{user.member && user.member.length > 0 && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleImpersonate(user.id, user.member![0].organizationId)}
												disabled={isImpersonating && selectedUserId === user.id}
											>
												{isImpersonating && selectedUserId === user.id ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<>
														<UserCheck className="h-4 w-4 mr-1" />
														Impersonate
													</>
												)}
											</Button>
										)}
									</div>
								))}
							</div>
						)}
					</TabsContent>

					<TabsContent value="organizations" className="flex-1 overflow-auto mt-4">
						{isLoadingOrgs ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : filteredOrgs?.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">No organizations found</div>
						) : (
							<div className="space-y-2">
								{filteredOrgs?.map((org) => (
									<div
										key={org.id}
										className="flex items-center justify-between p-3 rounded-lg border bg-card"
									>
										<div className="flex-1 min-w-0">
											<div className="font-medium truncate">{org.name}</div>
											<div className="text-sm text-muted-foreground truncate">
												{org.slug} {org.isPersonal && "(Personal)"}
											</div>
											<div className="text-xs text-muted-foreground mt-1">
												{org.memberCount} member{org.memberCount !== 1 ? "s" : ""}
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
