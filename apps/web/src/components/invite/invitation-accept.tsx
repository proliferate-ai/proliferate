"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { InvitationDetails } from "@/hooks/org/use-invitation";
import { Check, Clock, Users } from "lucide-react";
import { useRouter } from "next/navigation";

interface InvitationAcceptProps {
	invitation: InvitationDetails;
	accepting: boolean;
	rejecting: boolean;
	onAccept: () => void;
	onReject: () => void;
}

export function InvitationAccept({
	invitation,
	accepting,
	rejecting,
	onAccept,
	onReject,
}: InvitationAcceptProps) {
	const router = useRouter();
	const isExpired = new Date(invitation.expiresAt) < new Date();

	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="w-full max-w-md p-8">
				<div className="mb-8 text-center">
					<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
						<Users className="h-8 w-8 text-muted-foreground" />
					</div>
					<Text variant="h3" className="mb-2">
						Join {invitation.organizationName}
					</Text>
					<Text variant="body" color="muted">
						{invitation.inviterEmail} has invited you to join as a{" "}
						<Text as="span" className="font-medium text-foreground">
							{invitation.role}
						</Text>
					</Text>
				</div>

				<div className="mb-6 rounded-lg border border-border p-4">
					<div className="flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Invited by
						</Text>
						<Text variant="small">{invitation.inviterEmail}</Text>
					</div>
					<div className="mt-2 flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Your role
						</Text>
						<Text variant="small" className="capitalize">
							{invitation.role}
						</Text>
					</div>
					<div className="mt-2 flex items-center justify-between text-sm">
						<Text variant="small" color="muted">
							Expires
						</Text>
						<Text variant="small" className="flex items-center gap-1">
							<Clock className="h-3 w-3" />
							{new Date(invitation.expiresAt).toLocaleDateString()}
						</Text>
					</div>
				</div>

				{isExpired ? (
					<div className="text-center">
						<Text variant="body" color="destructive" className="mb-4">
							This invitation has expired.
						</Text>
						<Button variant="outline" onClick={() => router.push("/sessions")}>
							Go to Sessions
						</Button>
					</div>
				) : (
					<div className="flex gap-3">
						<Button
							variant="outline"
							className="flex-1"
							onClick={onReject}
							disabled={rejecting || accepting}
						>
							{rejecting ? "Declining..." : "Decline"}
						</Button>
						<Button className="flex-1" onClick={onAccept} disabled={accepting || rejecting}>
							{accepting ? (
								"Joining..."
							) : (
								<>
									<Check className="mr-2 h-4 w-4" />
									Accept Invitation
								</>
							)}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
