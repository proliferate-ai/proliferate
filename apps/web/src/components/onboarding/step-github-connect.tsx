"use client";

import { GitHubConnectButton } from "@/components/integrations/github-connect-button";
import { Button } from "@/components/ui/button";
import { CheckCircle, GithubIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	buildGitHubAppRegistrationUrl,
	getGitHubAppSetupUrl,
	getGitHubAppWebhookUrl,
	isLocalhostUrl,
} from "@/lib/github-app-registration";
import { env } from "@proliferate/environment/public";
import { useMemo, useState } from "react";

interface StepGitHubConnectProps {
	onComplete: () => void;
	hasGitHubConnection?: boolean;
}

export function StepGitHubConnect({ onComplete, hasGitHubConnection }: StepGitHubConnectProps) {
	const appUrl = env.NEXT_PUBLIC_APP_URL;
	const isLocalhost = isLocalhostUrl(appUrl);
	const setupUrl = getGitHubAppSetupUrl(appUrl);
	const webhookUrl = getGitHubAppWebhookUrl(appUrl);
	const [orgSlug, setOrgSlug] = useState("");

	const registrationUrl = useMemo(() => {
		return buildGitHubAppRegistrationUrl({
			appUrl,
			organization: orgSlug.trim() ? orgSlug.trim() : undefined,
			webhooksEnabled: !isLocalhost,
		});
	}, [appUrl, isLocalhost, orgSlug]);

	const githubAppSlug = env.NEXT_PUBLIC_GITHUB_APP_SLUG;
	const hasPlaceholderGitHubAppSlug =
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

					<div className="rounded-lg border border-border bg-muted/30 p-4 mb-4">
						<div className="space-y-1">
							<p className="text-sm font-medium text-foreground">
								Self-hosters: create your own GitHub App
							</p>
							<p className="text-sm text-muted-foreground">
								GitHub App installation and repo access work on localhost. Webhooks and
								webhook-based automations require a public URL (domain or tunnel).
							</p>
						</div>

						<div className="mt-4 space-y-3">
							<div className="space-y-1">
								<Label className="text-xs text-muted-foreground">GitHub org (optional)</Label>
								<Input
									value={orgSlug}
									onChange={(e) => setOrgSlug(e.target.value)}
									placeholder="my-org"
									className="h-9"
								/>
								<p className="text-xs text-muted-foreground">
									Leave blank to create the app under your personal GitHub account.
								</p>
							</div>

							<div className="flex flex-col gap-2">
								<Button
									type="button"
									variant="outline"
									className="w-full"
									onClick={() => window.open(registrationUrl, "_blank", "noreferrer")}
								>
									Create GitHub App
								</Button>
								<div className="space-y-1 text-xs text-muted-foreground">
									<p>
										After creating the app, set <span className="font-mono">GITHUB_APP_ID</span>,{" "}
										<span className="font-mono">GITHUB_APP_PRIVATE_KEY</span>,{" "}
										<span className="font-mono">GITHUB_APP_WEBHOOK_SECRET</span>, and{" "}
										<span className="font-mono">NEXT_PUBLIC_GITHUB_APP_SLUG</span>, then restart.
									</p>
									<p>
										Setup URL: <span className="font-mono">{setupUrl}</span>
									</p>
									{!isLocalhost && (
										<p>
											Webhook URL: <span className="font-mono">{webhookUrl}</span>
										</p>
									)}
									{isLocalhost && (
										<p>
											Localhost note: disable webhooks in the GitHub App settings, or use a tunnel /
											custom domain to receive them.
										</p>
									)}
								</div>
							</div>
						</div>
					</div>

					{hasPlaceholderGitHubAppSlug && (
						<p className="text-xs text-muted-foreground mb-2">
							Set <span className="font-mono">NEXT_PUBLIC_GITHUB_APP_SLUG</span> to your app&apos;s
							slug before installing.
						</p>
					)}

					<GitHubConnectButton
						onSuccess={onComplete}
						includeIcon={false}
						disabled={hasPlaceholderGitHubAppSlug}
					/>
				</div>
			</div>
		</div>
	);
}
