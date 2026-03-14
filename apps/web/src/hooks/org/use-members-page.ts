"use client";

import { useOrgMembersAndInvitations } from "@/hooks/org/use-orgs";
import { organization, useActiveOrganization, useSession } from "@/lib/auth/client";
import { REQUIRE_EMAIL_VERIFICATION } from "@/config/auth";
import { orpc } from "@/lib/infra/orpc";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function useMembersPage() {
	const queryClient = useQueryClient();
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;
	const isEmailVerified = authSession?.user?.emailVerified ?? false;

	const requireVerificationForInvites = REQUIRE_EMAIL_VERIFICATION;

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
		isActiveOrgPending,
		isLoading,
		members,
		invitations,
		currentUserId,
		isOwner,
		canInvite,
		isEmailVerified,
		requireVerificationForInvites,
		inviteEmail,
		inviteRole,
		isInviting,
		inviteError,
		setInviteEmail,
		setInviteRole,
		confirmRemoveMember,
		confirmCancelInvitation,
		setConfirmRemoveMember,
		setConfirmCancelInvitation,
		actionError,
		setActionError,
		handleInvite,
		handleUpdateRole,
		handleRemoveMember,
		handleCancelInvitation,
	};
}
