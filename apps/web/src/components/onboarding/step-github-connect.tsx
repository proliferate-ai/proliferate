"use client";

import { GitHubConnectButton } from "@/components/integrations/github-connect-button";
import { Button } from "@/components/ui/button";
import { CheckCircle, GithubIcon } from "@/components/ui/icons";
import { env } from "@proliferate/environment/public";

interface StepGitHubConnectProps {
	onComplete: () => void;
	onSkip?: () => void;
	hasGitHubConnection?: boolean;
}

export function StepGitHubConnect({
	onComplete,
	onSkip,
	hasGitHubConnection,
}: StepGitHubConnectProps) {
	const githubAppSlug = env.NEXT_PUBLIC_GITHUB_APP_SLUG;
	const hasPlaceholderSlug =
		!githubAppSlug || githubAppSlug === "local" || githubAppSlug === "proliferate-local-dev";

	// Already connected
	if (hasGitHubConnection) {
		return (
			<div className="w-full max-w-[420px]">
				<div className="rounded-2xl overflow-hidden border border-border mb-8">
					{/* GitHub Icon Area */}
					<div className="relative bg-gradient-to-br from-[#24292e] to-[#1a1e22] h-48 flex items-center justify-center">
						<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
							<CheckCircle className="h-10 w-10 text-white" />
						</div>
						<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
							<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
								Connected
							</span>
						</div>
					</div>

					{/* Form Content */}
					<div className="p-6 bg-card">
						<div className="mb-5 text-center">
							<h1 className="text-xl font-semibold text-foreground">GitHub Connected</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								Your GitHub account is connected. You can update the connection or continue to the
								dashboard.
							</p>
						</div>

						<div className="space-y-4">
							<div className="flex items-center justify-center gap-2 text-sm text-green-600">
								<CheckCircle className="h-4 w-4" />
								<span>GitHub already connected</span>
							</div>
							<div className="flex gap-3">
								<GitHubConnectButton onSuccess={onComplete} hasGitHubConnection />
								<Button variant="dark" onClick={onComplete} className="h-11 w-full rounded-lg">
									Continue
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Not connected yet
	return (
		<div className="w-full max-w-[420px]">
			<div className="rounded-2xl overflow-hidden border border-border mb-8">
				{/* GitHub Icon Area */}
				<div className="relative bg-gradient-to-br from-[#24292e] to-[#1a1e22] h-48 flex items-center justify-center">
					<div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center">
						<GithubIcon className="h-10 w-10 text-white" />
					</div>
					<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
						<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
							GitHub
						</span>
					</div>
				</div>

				{/* Form Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Connect to GitHub</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Agents need access to your code. We'll clone your repos into a cloud environment where
							they can write code, create branches, and open PRs.
						</p>
					</div>

					{hasPlaceholderSlug && (
						<div className="rounded-lg border border-border bg-muted/30 p-4 mb-4">
							<p className="text-sm font-medium text-foreground">GitHub App not configured</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Create a GitHub App before connecting.{" "}
								<a
									href="https://github.com/proliferate-ai/proliferate#step-2-create-a-github-app-required-for-repo-access"
									target="_blank"
									rel="noreferrer"
									className="underline text-foreground"
								>
									Follow README Step 2
								</a>{" "}
								for prefilled setup links and the env vars to add to{" "}
								<span className="font-mono text-xs">.env</span>.
							</p>
						</div>
					)}

					<GitHubConnectButton
						onSuccess={onComplete}
						includeIcon={false}
						disabled={hasPlaceholderSlug}
					/>

					{onSkip && (
						<Button
							variant="ghost"
							onClick={onSkip}
							className="w-full mt-2 text-sm text-muted-foreground hover:text-foreground"
						>
							Skip for now
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
