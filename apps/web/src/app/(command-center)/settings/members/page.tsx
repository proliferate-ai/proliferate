"use client";

import {
	ActionError,
	CancelInvitationDialog,
	InviteForm,
	MembersList,
	PendingInvitations,
	RemoveMemberDialog,
	useMembersPage,
} from "@/components/settings/members";
import { LoadingDots } from "@/components/ui/loading-dots";

export default function MembersPage() {
	const {
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
	} = useMembersPage();

	if (isActiveOrgPending) {
		return (
			<div className="py-8 text-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-10">
			<MembersList
				members={members}
				isLoading={isLoading}
				currentUserId={currentUserId}
				isOwner={isOwner}
				onUpdateRole={handleUpdateRole}
				onRemoveMember={setConfirmRemoveMember}
			/>

			<PendingInvitations
				invitations={invitations}
				isLoading={isLoading}
				canInvite={canInvite}
				onCancelInvitation={setConfirmCancelInvitation}
			/>

			{canInvite && (
				<InviteForm
					inviteEmail={inviteEmail}
					inviteRole={inviteRole}
					isInviting={isInviting}
					inviteError={inviteError}
					isEmailVerified={isEmailVerified}
					requireVerificationForInvites={requireVerificationForInvites}
					onEmailChange={setInviteEmail}
					onRoleChange={setInviteRole}
					onInvite={handleInvite}
				/>
			)}

			<ActionError error={actionError} onDismiss={() => setActionError(null)} />

			<RemoveMemberDialog
				member={confirmRemoveMember}
				onClose={() => setConfirmRemoveMember(null)}
				onConfirm={handleRemoveMember}
			/>

			<CancelInvitationDialog
				invitationId={confirmCancelInvitation}
				onClose={() => setConfirmCancelInvitation(null)}
				onConfirm={handleCancelInvitation}
			/>
		</div>
	);
}
