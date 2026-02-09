"use client";

import { Button } from "@/components/ui/button";
import { GithubIcon, RefreshCw } from "@/components/ui/icons";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import { shouldUseNangoForProvider, useNangoConnect } from "@/hooks/use-nango-connect";
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

	// Nango flow (when USE_NANGO_GITHUB=true AND integrations are enabled)
	const useNango = shouldUseNangoForProvider("github");
	const { connect: nangoConnect, isLoading: nangoLoading } = useNangoConnect({
		onSuccess: () => onSuccess?.(),
	});

	const isLoading = useNango ? nangoLoading : githubAppLoading;

	const handleConnect = () => {
		if (useNango) {
			nangoConnect("github" as any);
		} else {
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
