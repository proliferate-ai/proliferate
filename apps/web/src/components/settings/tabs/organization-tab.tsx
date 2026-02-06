"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { useOrgInvitations, useOrgMembers } from "@/hooks/use-orgs";
import {
	organization,
	sendVerificationEmail,
	useActiveOrganization,
	useListOrganizations,
	useSession,
} from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { env } from "@proliferate/environment/public";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mail, Pencil, Plus, Users, X } from "lucide-react";
import { useState } from "react";

export function OrganizationTab() {
	const queryClient = useQueryClient();
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: orgs } = useListOrganizations();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;
	const isEmailVerified = authSession?.user?.emailVerified ?? false;

	// Email verification requirements from env
	const requireVerificationForOrgCreation = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;
	const requireVerificationForInvites = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

	const [isCreating, setIsCreating] = useState(false);
	const [showCreateOrgForm, setShowCreateOrgForm] = useState(false);
	const [newOrgName, setNewOrgName] = useState("");
	const [createOrgError, setCreateOrgError] = useState<string | null>(null);
	const [isInviting, setIsInviting] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [isEditingName, setIsEditingName] = useState(false);
	const [editedName, setEditedName] = useState("");
	const [isUpdatingName, setIsUpdatingName] = useState(false);
	const [isEditingSlug, setIsEditingSlug] = useState(false);
	const [editedSlug, setEditedSlug] = useState("");
	const [isUpdatingSlug, setIsUpdatingSlug] = useState(false);
	const [slugError, setSlugError] = useState<string | null>(null);

	// Email verification
	const [isResendingVerification, setIsResendingVerification] = useState(false);
	const [verificationResent, setVerificationResent] = useState(false);
	const [verificationError, setVerificationError] = useState<string | null>(null);

	// Confirmation dialogs
	const [confirmRemoveMember, setConfirmRemoveMember] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [confirmCancelInvitation, setConfirmCancelInvitation] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// Fetch members
	const { data: members, isLoading: membersLoading } = useOrgMembers(activeOrg?.id ?? "");

	// Fetch invitations
	const { data: invitations, isLoading: invitationsLoading } = useOrgInvitations(
		activeOrg?.id ?? "",
	);

	// Find current user's role
	const currentUserRole = members?.find((m) => m.userId === currentUserId)?.role;
	const isOwner = currentUserRole === "owner";
	const canInvite = isOwner || currentUserRole === "admin";

	const handleCreateOrg = async () => {
		if (!newOrgName.trim()) {
			setCreateOrgError("Organization name is required");
			return;
		}

		setIsCreating(true);
		setCreateOrgError(null);
		try {
			const slug = newOrgName
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "");

			await organization.create({
				name: newOrgName.trim(),
				slug: `${slug}-${Date.now().toString(36)}`,
			});
			setShowCreateOrgForm(false);
			setNewOrgName("");
			window.location.reload();
		} catch (error) {
			console.error("Failed to create organization:", error);
			setCreateOrgError("Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	};

	const handleSwitchOrg = async (orgId: string) => {
		if (orgId === activeOrg?.id) return;
		await organization.setActive({ organizationId: orgId });
		window.location.reload();
	};

	const handleStartEditName = () => {
		setEditedName(activeOrg?.name || "");
		setIsEditingName(true);
	};

	const handleSaveName = async () => {
		if (!editedName.trim() || !activeOrg?.id || editedName === activeOrg.name) {
			setIsEditingName(false);
			return;
		}

		setIsUpdatingName(true);
		try {
			await organization.update({
				organizationId: activeOrg.id,
				data: { name: editedName.trim() },
			});
			window.location.reload();
		} catch (error) {
			console.error("Failed to update organization name:", error);
			setActionError("Failed to update organization name");
		} finally {
			setIsUpdatingName(false);
			setIsEditingName(false);
		}
	};

	const handleStartEditSlug = () => {
		setEditedSlug(activeOrg?.slug || "");
		setSlugError(null);
		setIsEditingSlug(true);
	};

	const handleSaveSlug = async () => {
		if (!activeOrg?.id) {
			setIsEditingSlug(false);
			return;
		}

		const sanitizedSlug = editedSlug
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");

		if (!sanitizedSlug || sanitizedSlug === activeOrg.slug) {
			setIsEditingSlug(false);
			return;
		}

		if (sanitizedSlug.length < 3) {
			setSlugError("Slug must be at least 3 characters");
			return;
		}

		setIsUpdatingSlug(true);
		setSlugError(null);
		try {
			await organization.update({
				organizationId: activeOrg.id,
				data: { slug: sanitizedSlug },
			});
			// Invalidate org queries to refresh the data
			queryClient.invalidateQueries({ queryKey: ["organizations"] });
			setIsEditingSlug(false);
		} catch (error: any) {
			console.error("Failed to update organization slug:", error);
			if (error?.message?.includes("unique") || error?.message?.includes("exists")) {
				setSlugError("This slug is already taken");
			} else {
				setSlugError("Failed to update slug");
			}
		} finally {
			setIsUpdatingSlug(false);
		}
	};

	const handleInvite = async () => {
		if (!inviteEmail.trim() || !activeOrg?.id) return;

		setIsInviting(true);
		setInviteError(null);

		try {
			const result = await organization.inviteMember({
				email: inviteEmail.trim(),
				role: inviteRole,
				organizationId: activeOrg.id,
			});

			if (result.error) {
				setInviteError(result.error.message || "Failed to send invitation");
			} else {
				setInviteEmail("");
				setInviteRole("member");
				queryClient.invalidateQueries({ queryKey: ["org-invitations", activeOrg.id] });
			}
		} catch (error) {
			setInviteError("Failed to send invitation");
		} finally {
			setIsInviting(false);
		}
	};

	const handleUpdateRole = async (memberId: string, newRole: "admin" | "member") => {
		if (!activeOrg?.id) return;

		try {
			await organization.updateMemberRole({
				memberId,
				role: newRole,
				organizationId: activeOrg.id,
			});
			queryClient.invalidateQueries({ queryKey: ["org-members", activeOrg.id] });
		} catch (error) {
			console.error("Failed to update role:", error);
			setActionError("Failed to update member role");
		}
	};

	const handleRemoveMember = async () => {
		if (!activeOrg?.id || !confirmRemoveMember) return;

		try {
			await organization.removeMember({
				memberIdOrEmail: confirmRemoveMember.id,
				organizationId: activeOrg.id,
			});
			queryClient.invalidateQueries({ queryKey: ["org-members", activeOrg.id] });
			setConfirmRemoveMember(null);
		} catch (error) {
			console.error("Failed to remove member:", error);
			setActionError("Failed to remove member");
			setConfirmRemoveMember(null);
		}
	};

	const handleCancelInvitation = async () => {
		if (!activeOrg?.id || !confirmCancelInvitation) return;

		try {
			await organization.cancelInvitation({
				invitationId: confirmCancelInvitation,
			});
			queryClient.invalidateQueries({ queryKey: ["org-invitations", activeOrg.id] });
			setConfirmCancelInvitation(null);
		} catch (error) {
			console.error("Failed to cancel invitation:", error);
			setActionError("Failed to cancel invitation");
			setConfirmCancelInvitation(null);
		}
	};

	const formatExpiresIn = (expiresAt: string) => {
		const diff = new Date(expiresAt).getTime() - Date.now();
		const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
		if (days <= 0) return "Expired";
		if (days === 1) return "Expires in 1 day";
		return `Expires in ${days} days`;
	};

	const handleResendVerification = async () => {
		const email = authSession?.user?.email;
		if (!email) return;

		setIsResendingVerification(true);
		setVerificationError(null);
		setVerificationResent(false);

		try {
			const result = await sendVerificationEmail({ email });
			if (result.error) {
				setVerificationError(result.error.message || "Failed to send verification email");
			} else {
				setVerificationResent(true);
			}
		} catch (error) {
			setVerificationError("Failed to send verification email");
		} finally {
			setIsResendingVerification(false);
		}
	};

	if (isActiveOrgPending) {
		return (
			<div className="py-8 text-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="mb-4">
				<Text variant="h4" className="text-lg">
					Organization
				</Text>
				<Text variant="body" color="muted" className="text-sm">
					Manage your organization settings and members.
				</Text>
			</div>

			{/* Email Verification Status */}
			{authSession?.user?.email && (
				<div className="p-4 border border-border rounded-lg">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Mail className="h-4 w-4 text-muted-foreground" />
							<div>
								<p className="text-sm font-medium">{authSession.user.email}</p>
								<p className={cn("text-xs", isEmailVerified ? "text-green-500" : "text-amber-500")}>
									{isEmailVerified ? (
										<span className="flex items-center gap-1">
											<CheckCircle2 className="h-3 w-3" />
											Email verified
										</span>
									) : (
										"Email not verified"
									)}
								</p>
							</div>
						</div>
						{!isEmailVerified && (
							<Button
								variant="outline"
								size="sm"
								onClick={handleResendVerification}
								disabled={isResendingVerification || verificationResent}
							>
								{isResendingVerification
									? "Sending..."
									: verificationResent
										? "Email sent"
										: "Resend verification"}
							</Button>
						)}
					</div>
					{verificationResent && (
						<p className="text-xs text-green-500 mt-2">
							Verification email sent. Check your inbox.
						</p>
					)}
					{verificationError && (
						<p className="text-xs text-destructive mt-2">{verificationError}</p>
					)}
				</div>
			)}

			{/* Current Organization */}
			{activeOrg && (
				<div className="space-y-3 p-3 md:p-4 border border-border rounded-lg bg-muted/20">
					{/* Name */}
					<div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
						<Text variant="small" color="muted" className="md:w-16 shrink-0">
							Name
						</Text>
						{isEditingName ? (
							<div className="flex flex-col gap-2 flex-1">
								<Input
									value={editedName}
									onChange={(e) => setEditedName(e.target.value)}
									className="h-8"
									autoFocus
									onKeyDown={(e) => {
										if (e.key === "Enter") handleSaveName();
										if (e.key === "Escape") setIsEditingName(false);
									}}
								/>
								<div className="flex gap-2">
									<Button size="sm" onClick={handleSaveName} disabled={isUpdatingName}>
										{isUpdatingName ? "..." : "Save"}
									</Button>
									<Button size="sm" variant="ghost" onClick={() => setIsEditingName(false)}>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<div className="flex items-center gap-2 flex-1 justify-between md:justify-start">
								<Text variant="small" className="font-medium">
									{activeOrg.name}
								</Text>
								{isOwner && (
									<Button
										variant="ghost"
										size="icon"
										className="h-6 w-6 text-muted-foreground hover:text-foreground"
										onClick={handleStartEditName}
									>
										<Pencil className="h-3 w-3" />
									</Button>
								)}
							</div>
						)}
					</div>

					{/* Slug */}
					<div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-4">
						<Text variant="small" color="muted" className="md:w-16 shrink-0 md:pt-1">
							Slug
						</Text>
						{isEditingSlug ? (
							<div className="flex flex-col gap-2 flex-1">
								<Input
									value={editedSlug}
									onChange={(e) => {
										setEditedSlug(e.target.value);
										setSlugError(null);
									}}
									className="h-8 font-mono text-sm"
									autoFocus
									onKeyDown={(e) => {
										if (e.key === "Enter") handleSaveSlug();
										if (e.key === "Escape") setIsEditingSlug(false);
									}}
								/>
								<p className="text-xs text-amber-600">Changing slug may break existing links</p>
								{slugError && <p className="text-xs text-destructive">{slugError}</p>}
								<div className="flex gap-2">
									<Button size="sm" onClick={handleSaveSlug} disabled={isUpdatingSlug}>
										{isUpdatingSlug ? "..." : "Save"}
									</Button>
									<Button size="sm" variant="ghost" onClick={() => setIsEditingSlug(false)}>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<div className="flex items-center gap-2 flex-1 justify-between md:justify-start">
								<Text variant="small" className="font-mono truncate">
									{activeOrg.slug}
								</Text>
								{isOwner && (
									<Button
										variant="ghost"
										size="icon"
										className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
										onClick={handleStartEditSlug}
									>
										<Pencil className="h-3 w-3" />
									</Button>
								)}
							</div>
						)}
					</div>

					{/* ID - hidden on mobile, visible on desktop */}
					<div className="hidden md:flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
						<Text variant="small" color="muted" className="md:w-16 shrink-0">
							ID
						</Text>
						<code className="text-xs bg-muted px-2 py-1 rounded truncate">{activeOrg.id}</code>
					</div>
				</div>
			)}

			{/* Switch Organization */}
			{orgs && orgs.length > 1 && (
				<div className="pt-4 border-t border-border">
					<h4 className="text-sm font-medium mb-3">Switch Organization</h4>
					<div className="space-y-1">
						{orgs
							.filter((org) => org.id !== activeOrg?.id)
							.map((org) => (
								<Button
									key={org.id}
									variant="ghost"
									onClick={() => handleSwitchOrg(org.id)}
									className="w-full justify-start p-2 h-auto text-sm"
								>
									{org.name}
								</Button>
							))}
					</div>
				</div>
			)}

			{/* Create Organization */}
			<div className="pt-4 border-t border-border">
				{requireVerificationForOrgCreation && !isEmailVerified ? (
					<p className="text-sm text-muted-foreground">
						Please verify your email to create new organizations.
					</p>
				) : showCreateOrgForm ? (
					<div className="p-4 border border-border rounded-lg bg-muted/30">
						<p className="text-sm font-medium mb-3">Create a new organization</p>
						<div className="flex gap-2">
							<Input
								placeholder="Organization name"
								value={newOrgName}
								onChange={(e) => {
									setNewOrgName(e.target.value);
									setCreateOrgError(null);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleCreateOrg();
									if (e.key === "Escape") {
										setShowCreateOrgForm(false);
										setNewOrgName("");
										setCreateOrgError(null);
									}
								}}
								autoFocus
								className="flex-1"
							/>
							<Button onClick={handleCreateOrg} disabled={isCreating || !newOrgName.trim()}>
								{isCreating ? "Creating..." : "Create"}
							</Button>
							<Button
								variant="ghost"
								onClick={() => {
									setShowCreateOrgForm(false);
									setNewOrgName("");
									setCreateOrgError(null);
								}}
							>
								Cancel
							</Button>
						</div>
						{createOrgError && <p className="text-sm text-destructive mt-2">{createOrgError}</p>}
					</div>
				) : (
					<Button variant="outline" size="sm" onClick={() => setShowCreateOrgForm(true)}>
						<Plus className="h-4 w-4 mr-2" />
						Create Organization
					</Button>
				)}
			</div>

			{/* Members Section */}
			<div className="pt-4 border-t border-border">
				<div className="flex items-center gap-2 mb-3">
					<Users className="h-4 w-4 text-muted-foreground" />
					<h4 className="text-sm font-medium">Members</h4>
				</div>

				{membersLoading ? (
					<div className="py-4 text-center">
						<LoadingDots size="sm" className="text-muted-foreground" />
					</div>
				) : members && members.length > 0 ? (
					<div className="space-y-2">
						{members.map((member) => {
							const isCurrentUser = member.userId === currentUserId;
							const canManage = isOwner && !isCurrentUser && member.role !== "owner";

							return (
								<div
									key={member.id}
									className="flex flex-col md:flex-row md:items-center gap-2 md:justify-between p-3 border border-border rounded-lg"
								>
									<div className="flex items-center gap-3 min-w-0">
										{member.user?.image ? (
											<img
												src={member.user.image}
												alt={member.user.name || ""}
												className="h-8 w-8 rounded-full shrink-0"
											/>
										) : (
											<div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
												<span className="text-xs font-medium">
													{(member.user?.name || member.user?.email || "?")[0]?.toUpperCase()}
												</span>
											</div>
										)}
										<div className="min-w-0">
											<p className="text-sm font-medium truncate">
												{member.user?.name || member.user?.email || "Unknown"}
												{isCurrentUser && (
													<span className="ml-1 text-xs text-muted-foreground">(you)</span>
												)}
											</p>
											<p className="text-xs text-muted-foreground truncate">
												{member.user?.email || "No email"}
											</p>
										</div>
									</div>

									<div className="flex items-center gap-2 justify-end md:justify-start shrink-0">
										{canManage ? (
											<Select
												value={member.role}
												onValueChange={(value: "admin" | "member") =>
													handleUpdateRole(member.id, value)
												}
											>
												<SelectTrigger className="w-24 h-8 text-xs">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="admin">Admin</SelectItem>
													<SelectItem value="member">Member</SelectItem>
												</SelectContent>
											</Select>
										) : (
											<span
												className={cn(
													"px-2 py-1 text-xs rounded-full capitalize",
													member.role === "owner" && "bg-primary/10 text-primary",
													member.role === "admin" && "bg-blue-500/10 text-blue-500",
													member.role === "member" && "bg-muted text-muted-foreground",
												)}
											>
												{member.role}
											</span>
										)}

										{canManage && (
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-destructive"
												onClick={() =>
													setConfirmRemoveMember({
														id: member.id,
														name: member.user?.name || member.user?.email || "Unknown",
													})
												}
											>
												<X className="h-4 w-4" />
											</Button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">No members found.</p>
				)}
			</div>

			{/* Invitations Section */}
			<div className="pt-4 border-t border-border">
				<div className="flex items-center gap-2 mb-3">
					<Mail className="h-4 w-4 text-muted-foreground" />
					<h4 className="text-sm font-medium">Invitations</h4>
				</div>

				{/* Pending Invitations */}
				{invitationsLoading ? (
					<div className="py-4 text-center">
						<LoadingDots size="sm" className="text-muted-foreground" />
					</div>
				) : invitations && invitations.length > 0 ? (
					<div className="space-y-2 mb-4">
						{invitations.map((invitation) => (
							<div
								key={invitation.id}
								className="flex items-center justify-between p-3 border border-border rounded-lg"
							>
								<div>
									<p className="text-sm font-medium">{invitation.email}</p>
									<p className="text-xs text-muted-foreground">
										{formatExpiresIn(invitation.expiresAt)} · {invitation.role}
									</p>
								</div>
								{canInvite && (
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground hover:text-destructive"
										onClick={() => setConfirmCancelInvitation(invitation.id)}
									>
										<X className="h-4 w-4" />
									</Button>
								)}
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-2 mb-4">
						No pending invitations.
					</p>
				)}

				{/* Invite Form */}
				{canInvite &&
					(requireVerificationForInvites && !isEmailVerified ? (
						<p className="text-sm text-muted-foreground">
							Please verify your email to invite team members.
						</p>
					) : (
						<div className="p-3 md:p-4 border border-border rounded-lg bg-muted/30">
							<p className="text-sm font-medium mb-3">Invite a team member</p>
							<div className="flex flex-col md:flex-row gap-2">
								<Input
									type="email"
									placeholder="email@example.com"
									value={inviteEmail}
									onChange={(e) => setInviteEmail(e.target.value)}
									className="flex-1"
								/>
								<div className="flex gap-2">
									<Select
										value={inviteRole}
										onValueChange={(value: "admin" | "member") => setInviteRole(value)}
									>
										<SelectTrigger className="w-28">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="member">Member</SelectItem>
											<SelectItem value="admin">Admin</SelectItem>
										</SelectContent>
									</Select>
									<Button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim()}>
										{isInviting ? "..." : "Invite"}
									</Button>
								</div>
							</div>
							{inviteError && <p className="text-sm text-destructive mt-2">{inviteError}</p>}
						</div>
					))}
			</div>

			{/* Action Error */}
			{actionError && (
				<div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
					<p className="text-sm text-destructive">{actionError}</p>
					<Button
						variant="ghost"
						size="sm"
						className="mt-1 h-6 text-xs"
						onClick={() => setActionError(null)}
					>
						Dismiss
					</Button>
				</div>
			)}

			{/* Remove Member Confirmation */}
			<AlertDialog
				open={!!confirmRemoveMember}
				onOpenChange={(open) => !open && setConfirmRemoveMember(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove member</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove {confirmRemoveMember?.name} from this organization?
							They will lose access to all organization resources.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleRemoveMember}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Cancel Invitation Confirmation */}
			<AlertDialog
				open={!!confirmCancelInvitation}
				onOpenChange={(open) => !open && setConfirmCancelInvitation(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel invitation</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to cancel this invitation? The invite link will no longer work.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep invitation</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleCancelInvitation}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Cancel invitation
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
