"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDashboardStore } from "@/stores/dashboard";
import { Box, Code, Zap } from "lucide-react";
import { useRouter } from "next/navigation";

interface WelcomeDialogProps {
	/** Organization name — shown when a user just accepted an invitation */
	joinedOrgName?: string;
	/** Called after the joined-org welcome is dismissed */
	onJoinedDismiss?: () => void;
}

export function WelcomeDialog({ joinedOrgName, onJoinedDismiss }: WelcomeDialogProps) {
	const { hasSeenWelcome, markWelcomeSeen } = useDashboardStore();
	const router = useRouter();

	// Invitation welcome — shown when a user just joined via invite
	if (joinedOrgName) {
		return (
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open) onJoinedDismiss?.();
				}}
			>
				<DialogContent className="max-w-lg border-border bg-card">
					<DialogHeader>
						<DialogTitle className="text-2xl">Welcome to {joinedOrgName}</DialogTitle>
						<DialogDescription>
							You&apos;ve joined the team. Here&apos;s what you can do.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
								<Box className="h-4 w-4 text-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">Snapshots</p>
								<p className="text-sm text-muted-foreground">
									Pre-configured cloud environments with your team&apos;s repos, dependencies, and
									services.
								</p>
							</div>
						</div>

						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
								<Code className="h-4 w-4 text-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">Sessions</p>
								<p className="text-sm text-muted-foreground">
									Start coding sessions from a snapshot. Your agent gets a fully configured
									environment in seconds.
								</p>
							</div>
						</div>

						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
								<Zap className="h-4 w-4 text-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">Automations</p>
								<p className="text-sm text-muted-foreground">
									Trigger sessions automatically from GitHub issues, Slack messages, or webhooks.
								</p>
							</div>
						</div>
					</div>

					<div className="pt-2">
						<Button
							className="w-full"
							onClick={() => {
								markWelcomeSeen();
								onJoinedDismiss?.();
							}}
						>
							Get started
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	// Standard welcome — shown for new users who signed up directly
	if (hasSeenWelcome) return null;

	return (
		<>
			<Dialog open={!hasSeenWelcome} onOpenChange={(open) => !open && markWelcomeSeen()}>
				<DialogContent className="max-w-lg border-border bg-card">
					<DialogHeader>
						<DialogTitle className="text-2xl">Welcome to Proliferate</DialogTitle>
						<DialogDescription>
							AI agents that code in fully configured cloud environments.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
								<Box className="h-4 w-4 text-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">Snapshots</p>
								<p className="text-sm text-muted-foreground">
									Configure a cloud environment with your repos, dependencies, and services. Save it
									as a snapshot so every session starts instantly.
								</p>
							</div>
						</div>

						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
								<Code className="h-4 w-4 text-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">Sessions</p>
								<p className="text-sm text-muted-foreground">
									Start coding sessions from a snapshot. Your agent gets a fully configured
									environment in seconds — ready to write code and open PRs.
								</p>
							</div>
						</div>

						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
								<Zap className="h-4 w-4 text-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">Automations</p>
								<p className="text-sm text-muted-foreground">
									Trigger sessions automatically from GitHub issues, Slack messages, or webhooks.
									Agents work in the background and report back.
								</p>
							</div>
						</div>
					</div>

					<div className="flex gap-3 pt-2">
						<Button variant="outline" className="flex-1" onClick={markWelcomeSeen}>
							Explore dashboard
						</Button>
						<Button
							className="flex-1"
							onClick={() => {
								markWelcomeSeen();
								router.push("/dashboard/integrations");
							}}
						>
							Connect your repositories
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
