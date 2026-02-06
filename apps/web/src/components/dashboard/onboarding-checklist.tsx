"use client";

import { GitHubConnectButton } from "@/components/integrations/github-connect-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import type { OnboardingState } from "@/hooks/use-onboarding";
import { Check, Circle } from "lucide-react";

interface OnboardingChecklistProps {
	state: OnboardingState;
	onGitHubConnected: () => void;
	onAddRepo: () => void;
}

export function OnboardingChecklist({
	state,
	onGitHubConnected,
	onAddRepo,
}: OnboardingChecklistProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Get started</CardTitle>
				<CardDescription>Complete these steps to start using Proliferate</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="space-y-4">
					{/* Step 1: Create account - always complete if on dashboard */}
					<li className="flex items-start gap-3">
						<div className="mt-0.5">
							<div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
								<Check className="h-3 w-3 text-white" />
							</div>
						</div>
						<div className="flex-1 min-w-0">
							<Text variant="small" className="font-medium">
								Create account
							</Text>
							<Text variant="small" color="muted">
								Sign up for Proliferate
							</Text>
						</div>
					</li>

					{/* Step 2: Connect GitHub */}
					<li className="flex items-start gap-3">
						<div className="mt-0.5">
							{state.hasGitHubConnection ? (
								<div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
									<Check className="h-3 w-3 text-white" />
								</div>
							) : (
								<Circle className="h-5 w-5 text-muted-foreground" />
							)}
						</div>
						<div className="flex-1 min-w-0">
							<Text variant="small" className="font-medium">
								Connect GitHub
							</Text>
							<Text variant="small" color="muted" className="mb-3">
								Link your GitHub account to access repositories
							</Text>
							{!state.hasGitHubConnection && <GitHubConnectButton onSuccess={onGitHubConnected} />}
						</div>
					</li>

					{/* Step 3: Add repository */}
					<li className="flex items-start gap-3">
						<div className="mt-0.5">
							{state.hasRepos ? (
								<div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center">
									<Check className="h-3 w-3 text-white" />
								</div>
							) : (
								<Circle
									className={`h-5 w-5 ${
										!state.hasGitHubConnection
											? "text-muted-foreground/40"
											: "text-muted-foreground"
									}`}
								/>
							)}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center justify-between gap-2">
								<Text
									variant="small"
									className={`font-medium ${!state.hasGitHubConnection ? "text-muted-foreground/60" : ""}`}
								>
									Add repository
								</Text>
								{state.hasGitHubConnection && (
									<Button variant="link" onClick={onAddRepo} className="p-0 h-auto text-sm">
										{state.hasRepos ? "Add another" : "Add repository"}
									</Button>
								)}
							</div>
							<Text
								variant="small"
								color="muted"
								className={!state.hasGitHubConnection ? "text-muted-foreground/40" : ""}
							>
								Select a repository to work with
							</Text>
						</div>
					</li>

					{/* Step 4: Set up repository (disabled) */}
					<li className="flex items-start gap-3">
						<div className="mt-0.5">
							<Circle className="h-5 w-5 text-muted-foreground/40" />
						</div>
						<div className="flex-1 min-w-0">
							<Text variant="small" className="font-medium text-muted-foreground/60">
								Set up repository
							</Text>
							<Text variant="small" color="muted" className="text-muted-foreground/40">
								Configure your repository for coding agents
							</Text>
						</div>
					</li>
				</ul>
			</CardContent>
		</Card>
	);
}
