"use client";

import { Button } from "@/components/ui/button";
import { GithubIcon, RefreshCw } from "@/components/ui/icons";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import { USE_NANGO_GITHUB, useNangoConnect } from "@/hooks/use-nango-connect";
import type { ReactNode } from "react";

interface GitHubConnectButtonProps {
	onSuccess?: () => void;
	hasGitHubConnection?: boolean;
	/** Render as icon-only reconnect button */
	iconOnly?: boolean;
	/** Custom icon for iconOnly mode */
	icon?: ReactNode;
	/** Include the GitHub icon in the button */
	includeIcon?: boolean;
	/** URL to redirect back to after GitHub auth (passed as state param) */
	returnUrl?: string;
	/** Target org ID for CLI flows - ensures integration is saved to correct org */
	targetOrgId?: string;
	disabled?: boolean;
}

export function GitHubConnectButton({
	onSuccess,
	hasGitHubConnection = false,
	iconOnly = false,
	icon,
	includeIcon = true,
	returnUrl,
	targetOrgId,
	disabled = false,
}: GitHubConnectButtonProps) {
	// GitHub App flow (production default)
	const { connect: githubAppConnect, isLoading: githubAppLoading } = useGitHubAppConnect({
		onSuccess: () => onSuccess?.(),
		returnUrl,
		targetOrgId,
	});

	// Nango flow (local dev when USE_NANGO_GITHUB=true)
	const { connect: nangoConnect, isLoading: nangoLoading } = useNangoConnect({
		onSuccess: () => onSuccess?.(),
	});

	const isLoading = USE_NANGO_GITHUB ? nangoLoading : githubAppLoading;

	const handleConnect = () => {
		console.log(`[GitHubConnectButton] USE_NANGO_GITHUB=${USE_NANGO_GITHUB}`);
		if (USE_NANGO_GITHUB) {
			console.log("[GitHubConnectButton] Using Nango flow");
			nangoConnect("github" as any);
		} else {
			console.log("[GitHubConnectButton] Using GitHub App flow");
			githubAppConnect();
		}
	};

	if (iconOnly) {
		return (
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8 text-muted-foreground hover:text-foreground"
				onClick={handleConnect}
				disabled={isLoading || disabled}
			>
				{isLoading ? (
					<RefreshCw className="h-4 w-4 animate-spin" />
				) : (
					icon || <RefreshCw className="h-4 w-4" />
				)}
			</Button>
		);
	}

	return (
		<Button onClick={handleConnect} disabled={isLoading || disabled} className="w-full">
			{includeIcon && <GithubIcon className="mr-2 h-4 w-4" />}
			{isLoading
				? "Connecting..."
				: hasGitHubConnection
					? "Update GitHub Connection"
					: "Connect GitHub"}
		</Button>
	);
}
