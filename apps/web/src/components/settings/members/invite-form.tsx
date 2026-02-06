"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SettingsSection } from "../settings-row";

interface InviteFormProps {
	inviteEmail: string;
	inviteRole: "admin" | "member";
	isInviting: boolean;
	inviteError: string | null;
	isEmailVerified: boolean;
	requireVerificationForInvites: boolean;
	onEmailChange: (email: string) => void;
	onRoleChange: (role: "admin" | "member") => void;
	onInvite: () => void;
}

export function InviteForm({
	inviteEmail,
	inviteRole,
	isInviting,
	inviteError,
	isEmailVerified,
	requireVerificationForInvites,
	onEmailChange,
	onRoleChange,
	onInvite,
}: InviteFormProps) {
	return (
		<SettingsSection title="Invite a Team Member">
			{requireVerificationForInvites && !isEmailVerified ? (
				<p className="text-sm text-muted-foreground">
					Please verify your email to invite team members.
				</p>
			) : (
				<div className="rounded-lg border border-border/80 bg-background p-4 space-y-3">
					<div className="flex items-center gap-2">
						<Input
							type="email"
							placeholder="email@example.com"
							value={inviteEmail}
							onChange={(e) => onEmailChange(e.target.value)}
							className="flex-1 h-8 text-sm"
							onKeyDown={(e) => {
								if (e.key === "Enter") onInvite();
							}}
						/>
						<Select value={inviteRole} onValueChange={onRoleChange}>
							<SelectTrigger className="w-24 h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="member">Member</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
							</SelectContent>
						</Select>
						<Button
							size="sm"
							className="h-8"
							onClick={onInvite}
							disabled={isInviting || !inviteEmail.trim()}
						>
							{isInviting ? "..." : "Invite"}
						</Button>
					</div>
					{inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
				</div>
			)}
		</SettingsSection>
	);
}
