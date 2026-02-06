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

interface RemoveMemberDialogProps {
	member: { id: string; name: string } | null;
	onClose: () => void;
	onConfirm: () => void;
}

export function RemoveMemberDialog({ member, onClose, onConfirm }: RemoveMemberDialogProps) {
	return (
		<AlertDialog open={!!member} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove member</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to remove {member?.name} from this workspace? They will lose
						access to all workspace resources.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Remove
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

interface CancelInvitationDialogProps {
	invitationId: string | null;
	onClose: () => void;
	onConfirm: () => void;
}

export function CancelInvitationDialog({
	invitationId,
	onClose,
	onConfirm,
}: CancelInvitationDialogProps) {
	return (
		<AlertDialog open={!!invitationId} onOpenChange={(open) => !open && onClose()}>
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
						onClick={onConfirm}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Cancel invitation
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
