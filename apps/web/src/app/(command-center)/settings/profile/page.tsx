"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings/settings-row";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGitIdentity } from "@/hooks/settings/use-git-identity";
import { useSession } from "@/lib/auth/client";
import { getUserInitials } from "@/lib/display/format";
import { AlertTriangle, CheckCircle2, Github, Loader2 } from "lucide-react";
import { Suspense } from "react";

function GitIdentitySection() {
	const {
		gitIdentity,
		isLoading,
		isSyncing,
		isClearing,
		linkGitHub,
		syncFromGitHub,
		clearIdentity,
	} = useGitIdentity();

	if (isLoading) {
		return (
			<SettingsSection title="Git identity">
				<SettingsCard>
					<SettingsRow label="Loading..." description="Checking git identity configuration">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</SettingsRow>
				</SettingsCard>
			</SettingsSection>
		);
	}

	// GitHub not linked
	if (!gitIdentity?.githubLinked) {
		return (
			<SettingsSection title="Git identity">
				<SettingsCard>
					<SettingsRow
						label="GitHub account"
						description="Connect GitHub so commits from sessions are attributed to you"
					>
						<Button variant="outline" size="sm" onClick={linkGitHub}>
							<Github className="h-4 w-4 mr-1.5" />
							Connect GitHub
						</Button>
					</SettingsRow>
				</SettingsCard>
			</SettingsSection>
		);
	}

	// Linked but missing repo scope
	if (!gitIdentity.hasRepoScope) {
		return (
			<SettingsSection title="Git identity">
				<SettingsCard>
					<SettingsRow
						label="GitHub connected"
						description="Missing repo access — commits can't be pushed as you"
					>
						<div className="flex items-center gap-2">
							<AlertTriangle className="h-4 w-4 text-warning" />
							<Button variant="outline" size="sm" onClick={linkGitHub}>
								Re-connect with repo access
							</Button>
						</div>
					</SettingsRow>
				</SettingsCard>
			</SettingsSection>
		);
	}

	// Linked + repo scope, but identity not synced yet
	if (!gitIdentity.gitName && !gitIdentity.gitEmail) {
		return (
			<SettingsSection title="Git identity">
				<SettingsCard>
					<SettingsRow
						label="GitHub connected"
						description="Sync your GitHub profile to set your git commit identity"
					>
						<Button variant="outline" size="sm" onClick={syncFromGitHub} disabled={isSyncing}>
							{isSyncing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
							Sync from GitHub
						</Button>
					</SettingsRow>
				</SettingsCard>
			</SettingsSection>
		);
	}

	// Fully configured
	return (
		<SettingsSection title="Git identity">
			<SettingsCard>
				<SettingsRow label="Commit author" description="Name used for git commits">
					<div className="flex items-center gap-2">
						<Input
							value={gitIdentity.gitName ?? ""}
							disabled
							className="w-40 h-8 text-sm bg-muted/50"
						/>
						<CheckCircle2 className="h-4 w-4 text-success" />
					</div>
				</SettingsRow>
				<SettingsRow label="Commit email" description="Email used for git commits">
					<Input
						value={gitIdentity.gitEmail ?? ""}
						disabled
						className="w-48 h-8 text-sm bg-muted/50"
					/>
				</SettingsRow>
				<SettingsRow label="" description="Commits from sessions will be attributed to you">
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={syncFromGitHub} disabled={isSyncing}>
							{isSyncing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
							Re-sync
						</Button>
						<Button variant="ghost" size="sm" onClick={clearIdentity} disabled={isClearing}>
							Disconnect
						</Button>
					</div>
				</SettingsRow>
			</SettingsCard>
		</SettingsSection>
	);
}

export default function ProfilePage() {
	const { data: authSession } = useSession();
	const user = authSession?.user;

	return (
		<PageShell title="Profile" subtitle="Manage your account" maxWidth="2xl">
			<SettingsCard>
				<SettingsRow label="Profile picture" description="How you appear around the app">
					<Avatar className="h-9 w-9">
						<AvatarImage src={user?.image || undefined} alt={user?.name || "User"} />
						<AvatarFallback className="text-xs">
							{getUserInitials(user?.name, user?.email)}
						</AvatarFallback>
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
						{user?.emailVerified && <CheckCircle2 className="h-4 w-4 text-success" />}
					</div>
				</SettingsRow>
			</SettingsCard>

			<Suspense>
				<GitIdentitySection />
			</Suspense>
		</PageShell>
	);
}
