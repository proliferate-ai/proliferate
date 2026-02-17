"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { getSetupInitialPrompt } from "@/lib/prompts";
import { useDashboardStore } from "@/stores/dashboard";
import { Box, Code, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SnapshotSelector } from "./snapshot-selector";

export function WelcomeDialog() {
	const { hasSeenWelcome, markWelcomeSeen, setPendingPrompt } = useDashboardStore();
	const [showCreate, setShowCreate] = useState(false);
	const router = useRouter();

	if (hasSeenWelcome && !showCreate) return null;

	return (
		<>
			<Dialog open={!hasSeenWelcome} onOpenChange={(open) => !open && markWelcomeSeen()}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="text-2xl">Welcome to Proliferate</DialogTitle>
						<DialogDescription>
							AI agents that code in fully configured cloud environments.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						<div className="flex gap-3">
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
								<Box className="h-4 w-4 text-primary" />
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
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
								<Code className="h-4 w-4 text-primary" />
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
							<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
								<Zap className="h-4 w-4 text-primary" />
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
								setShowCreate(true);
							}}
						>
							Create your first snapshot
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={showCreate} onOpenChange={setShowCreate}>
				<DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>Create your first snapshot</DialogTitle>
						<DialogDescription>
							Select repositories to include in your configuration
						</DialogDescription>
					</DialogHeader>
					<SnapshotSelector
						mode="create"
						onCreate={(_configurationId, sessionId) => {
							setShowCreate(false);
							setPendingPrompt(getSetupInitialPrompt());
							router.push(`/workspace/${sessionId}`);
						}}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}
