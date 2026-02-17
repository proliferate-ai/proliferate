"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SettingsCard, SettingsRow } from "@/components/settings/settings-row";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import { CheckCircle2 } from "lucide-react";

export default function ProfilePage() {
	const { data: authSession } = useSession();
	const user = authSession?.user;

	const userInitials = user?.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: user?.email?.[0]?.toUpperCase() || "?";

	return (
		<PageShell title="Profile" subtitle="Manage your account" maxWidth="2xl">
			<SettingsCard>
				<SettingsRow label="Profile picture" description="How you appear around the app">
					<Avatar className="h-9 w-9">
						<AvatarImage src={user?.image || undefined} alt={user?.name || "User"} />
						<AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
					</Avatar>
				</SettingsRow>
				<SettingsRow label="Full name" description="Your display name">
					<Input
						value={user?.name || ""}
						disabled
						className="w-40 h-8 text-sm bg-muted/50"
						placeholder="Your name"
					/>
				</SettingsRow>
				<SettingsRow label="Email" description="Your login email">
					<div className="flex items-center gap-2">
						<Input value={user?.email || ""} disabled className="w-48 h-8 text-sm bg-muted/50" />
						{user?.emailVerified && <CheckCircle2 className="h-4 w-4 text-green-500" />}
					</div>
				</SettingsRow>
			</SettingsCard>
		</PageShell>
	);
}
