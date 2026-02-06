"use client";

import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Mail, X } from "lucide-react";
import { SettingsSection } from "../settings-row";

export interface Invitation {
	id: string;
	email: string;
	role: "owner" | "admin" | "member";
	status: string;
	expiresAt: string;
	createdAt: string;
	inviter: {
		name: string | null;
		email: string;
	} | null;
}

interface PendingInvitationsProps {
	invitations: Invitation[] | undefined;
	isLoading: boolean;
	canInvite: boolean;
	onCancelInvitation: (invitationId: string) => void;
}

function formatExpiresIn(expiresAt: string): string {
	const diff = new Date(expiresAt).getTime() - Date.now();
	const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
	if (days <= 0) return "Expired";
	if (days === 1) return "Expires in 1 day";
	return `Expires in ${days} days`;
}

export function PendingInvitations({
	invitations,
	isLoading,
	canInvite,
	onCancelInvitation,
}: PendingInvitationsProps) {
	return (
		<SettingsSection title="Pending Invitations">
			{isLoading ? (
				<div className="py-4 text-center">
					<LoadingDots size="sm" className="text-muted-foreground" />
				</div>
			) : invitations && invitations.length > 0 ? (
				<div className="rounded-lg border border-border/80 bg-background divide-y divide-border/60">
					{invitations.map((invitation) => (
						<div key={invitation.id} className="flex items-center justify-between px-4 py-3">
							<div className="flex items-center gap-3">
								<div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
									<Mail className="h-4 w-4 text-muted-foreground" />
								</div>
								<div>
									<p className="text-sm font-medium">{invitation.email}</p>
									<p className="text-xs text-muted-foreground">
										{formatExpiresIn(invitation.expiresAt)} · {invitation.role}
									</p>
								</div>
							</div>
							{canInvite && (
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 text-muted-foreground hover:text-destructive"
									onClick={() => onCancelInvitation(invitation.id)}
								>
									<X className="h-3 w-3" />
								</Button>
							)}
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border/80 bg-background py-6 text-center">
					<p className="text-sm text-muted-foreground">No pending invitations</p>
				</div>
			)}
		</SettingsSection>
	);
}
