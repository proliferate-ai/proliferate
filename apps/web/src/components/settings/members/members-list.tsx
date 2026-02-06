"use client";

import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { SettingsSection } from "../settings-row";

export interface Member {
	id: string;
	userId: string;
	role: "owner" | "admin" | "member";
	createdAt: string;
	user: {
		id: string;
		name: string | null;
		email: string;
		image: string | null;
	} | null;
}

interface MembersListProps {
	members: Member[] | undefined;
	isLoading: boolean;
	currentUserId: string | undefined;
	isOwner: boolean;
	onUpdateRole: (memberId: string, newRole: "admin" | "member") => void;
	onRemoveMember: (member: { id: string; name: string }) => void;
}

export function MembersList({
	members,
	isLoading,
	currentUserId,
	isOwner,
	onUpdateRole,
	onRemoveMember,
}: MembersListProps) {
	return (
		<SettingsSection
			title={`${members?.length || 0} ${members?.length === 1 ? "member" : "members"}`}
		>
			{isLoading ? (
				<div className="py-4 text-center">
					<LoadingDots size="sm" className="text-muted-foreground" />
				</div>
			) : members && members.length > 0 ? (
				<div className="rounded-lg border border-border/80 bg-background divide-y divide-border/60">
					{members.map((member) => {
						// Skip members without user data
						if (!member.user) return null;
						const { user } = member;

						const isCurrentUser = member.userId === currentUserId;
						const canManage = isOwner && !isCurrentUser && member.role !== "owner";

						return (
							<div key={member.id} className="flex items-center justify-between px-4 py-3">
								<div className="flex items-center gap-3 min-w-0">
									{user.image ? (
										<img
											src={user.image}
											alt={user.name || ""}
											className="h-9 w-9 rounded-full shrink-0"
										/>
									) : (
										<div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
											<span className="text-sm font-medium">
												{(user.name || user.email)[0]?.toUpperCase()}
											</span>
										</div>
									)}
									<div className="min-w-0">
										<p className="text-sm font-medium truncate">
											{user.name || user.email}
											{isCurrentUser && (
												<span className="ml-2 text-xs text-muted-foreground">(you)</span>
											)}
										</p>
										<p className="text-xs text-muted-foreground truncate">{user.email}</p>
									</div>
								</div>

								<div className="flex items-center gap-2 shrink-0">
									{canManage ? (
										<Select
											value={member.role}
											onValueChange={(value: "admin" | "member") => onUpdateRole(member.id, value)}
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
												"px-2 py-0.5 text-xs rounded-full capitalize",
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
											className="h-6 w-6 text-muted-foreground hover:text-destructive"
											onClick={() =>
												onRemoveMember({
													id: member.id,
													name: user.name || user.email,
												})
											}
										>
											<X className="h-3 w-3" />
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
		</SettingsSection>
	);
}
