"use client";

import { useDisconnectIntegration } from "@/hooks/use-integrations";
import { env } from "@proliferate/environment/public";
import { useCallback } from "react";

interface UseGitHubAppConnectOptions {
	onSuccess?: () => void;
	onError?: (error: unknown) => void;
	/** URL to redirect back to after GitHub auth (passed as state param) */
	returnUrl?: string;
	/** Target org ID for CLI flows - ensures integration is saved to correct org */
	targetOrgId?: string;
}

interface UseGitHubAppConnectReturn {
	connect: () => void;
	disconnect: (integrationId: string) => Promise<void>;
	isLoading: boolean;
	error: string | null;
}

const GITHUB_APP_SLUG = env.NEXT_PUBLIC_GITHUB_APP_SLUG;

/**
 * Hook for connecting to GitHub via GitHub App installation flow.
 * Unlike Nango, this simply redirects to GitHub's installation page.
 */
export function useGitHubAppConnect(
	options: UseGitHubAppConnectOptions = {},
): UseGitHubAppConnectReturn {
	const { onSuccess, onError, returnUrl, targetOrgId } = options;
	const disconnectMutation = useDisconnectIntegration();

	const connect = useCallback(() => {
		// Simply redirect to GitHub's app installation page
		// GitHub will redirect back to our callback URL after installation
		let installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
		const resolvedReturnUrl =
			returnUrl ??
			(typeof window !== "undefined"
				? `${window.location.pathname}${window.location.search}`
				: undefined);
		// Pass state as JSON with returnUrl and targetOrgId
		if (resolvedReturnUrl || targetOrgId) {
			const state = JSON.stringify({ returnUrl: resolvedReturnUrl, targetOrgId });
			installUrl += `?state=${encodeURIComponent(state)}`;
		}
		window.location.href = installUrl;
	}, [returnUrl, targetOrgId]);

	const disconnect = useCallback(
		async (integrationId: string) => {
			try {
				await disconnectMutation.mutateAsync(integrationId);
				onSuccess?.();
			} catch (err) {
				console.error("Failed to disconnect GitHub:", err);
				onError?.(err);
			}
		},
		[disconnectMutation, onSuccess, onError],
	);

	return {
		connect,
		disconnect,
		isLoading: disconnectMutation.isPending,
		error: disconnectMutation.error?.message ?? null,
	};
}
