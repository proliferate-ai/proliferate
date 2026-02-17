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
import { authClient } from "@/lib/auth-client";
import { Mail, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

interface StepInviteMembersProps {
	onComplete: () => void;
}

interface PendingInvite {
	email: string;
	role: "admin" | "member";
	status: "sent" | "error";
	error?: string;
}

export function StepInviteMembers({ onComplete }: StepInviteMembersProps) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"admin" | "member">("member");
	const [invites, setInvites] = useState<PendingInvite[]>([]);
	const [isInviting, setIsInviting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleInvite = async () => {
		const trimmed = email.trim();
		if (!trimmed) return;

		setIsInviting(true);
		setError(null);

		try {
			await authClient.organization.inviteMember({
				email: trimmed,
				role,
			});
			setInvites((prev) => [...prev, { email: trimmed, role, status: "sent" }]);
			setEmail("");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to send invitation";
			setError(message);
			setInvites((prev) => [...prev, { email: trimmed, role, status: "error", error: message }]);
		} finally {
			setIsInviting(false);
		}
	};

	const removeInvite = (index: number) => {
		setInvites((prev) => prev.filter((_, i) => i !== index));
	};

	const sentCount = invites.filter((i) => i.status === "sent").length;

	return (
		<div className="w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Image Area */}
				<div className="relative bg-black" style={{ aspectRatio: "1360 / 880" }}>
					<Image src="/single.png" alt="Invite your team" fill className="object-cover" />
					<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
						<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
							Team
						</span>
					</div>
				</div>

				{/* Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Invite your team</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Add team members to collaborate on projects.
						</p>
					</div>

					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<Input
								type="email"
								placeholder="email@example.com"
								value={email}
								onChange={(e) => {
									setEmail(e.target.value);
									setError(null);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleInvite();
								}}
								className="flex-1 h-9 text-sm"
							/>
							<Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
								<SelectTrigger className="w-24 h-9 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="member">Member</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
								</SelectContent>
							</Select>
							<Button
								size="sm"
								className="h-9"
								onClick={handleInvite}
								disabled={isInviting || !email.trim()}
							>
								{isInviting ? "..." : "Invite"}
							</Button>
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}

						{invites.length > 0 && (
							<div className="space-y-2 pt-3 border-t border-border">
								{invites.map((invite, i) => (
									<div
										key={`${invite.email}-${i}`}
										className="flex items-center justify-between text-sm"
									>
										<div className="flex items-center gap-2 min-w-0">
											<Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
											<span className="truncate">{invite.email}</span>
											<span className="text-xs text-muted-foreground">({invite.role})</span>
										</div>
										<div className="flex items-center gap-2 shrink-0">
											{invite.status === "sent" ? (
												<span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
													Sent
												</span>
											) : (
												<span className="text-xs text-destructive">Failed</span>
											)}
											<button
												type="button"
												onClick={() => removeInvite(i)}
												className="text-muted-foreground hover:text-foreground"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="mt-5 flex gap-3">
						<Button variant="outline" onClick={onComplete} className="h-11 flex-1 rounded-lg">
							Skip for now
						</Button>
						{sentCount > 0 && (
							<Button variant="dark" onClick={onComplete} className="h-11 flex-1 rounded-lg">
								Continue
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
