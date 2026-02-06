"use client";

import { useOrgMembersAndInvitations } from "@/hooks/use-orgs";
import { organization, useActiveOrganization, useSession } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { env } from "@proliferate/environment/public";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function useMembersPage() {
	const queryClient = useQueryClient();
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;
	const isEmailVerified = authSession?.user?.emailVerified ?? false;

	const requireVerificationForInvites = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

	// State
	const [isInviting, setIsInviting] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [confirmRemoveMember, setConfirmRemoveMember] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [confirmCancelInvitation, setConfirmCancelInvitation] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// Fetch members and invitations in a single request
	const { data, isLoading } = useOrgMembersAndInvitations(activeOrg?.id);

	const members = data?.members;
	const invitations = data?.invitations;
	const currentUserRole = data?.currentUserRole;
	const isOwner = currentUserRole === "owner";
	const canInvite = isOwner || currentUserRole === "admin";

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
				queryClient.invalidateQueries({ queryKey: orpc.orgs.getMembersAndInvitations.key() });
			}
		} catch {
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
			queryClient.invalidateQueries({ queryKey: orpc.orgs.getMembersAndInvitations.key() });
		} catch {
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
			queryClient.invalidateQueries({ queryKey: orpc.orgs.getMembersAndInvitations.key() });
		} catch {
			setActionError("Failed to remove member");
		}
		setConfirmRemoveMember(null);
	};

	const handleCancelInvitation = async () => {
		if (!activeOrg?.id || !confirmCancelInvitation) return;
		try {
			await organization.cancelInvitation({ invitationId: confirmCancelInvitation });
			queryClient.invalidateQueries({ queryKey: orpc.orgs.getMembersAndInvitations.key() });
		} catch {
			setActionError("Failed to cancel invitation");
		}
		setConfirmCancelInvitation(null);
	};

	return {
		// Loading state
		isActiveOrgPending,
		isLoading,

		// Data
		members,
		invitations,
		currentUserId,
		isOwner,
		canInvite,
		isEmailVerified,
		requireVerificationForInvites,

		// Invite form state
		inviteEmail,
		inviteRole,
		isInviting,
		inviteError,
		setInviteEmail,
		setInviteRole,

		// Confirmation dialogs
		confirmRemoveMember,
		confirmCancelInvitation,
		setConfirmRemoveMember,
		setConfirmCancelInvitation,

		// Errors
		actionError,
		setActionError,

		// Handlers
		handleInvite,
		handleUpdateRole,
		handleRemoveMember,
		handleCancelInvitation,
	};
}
