"use client";

import { useDisconnectIntegration } from "@/hooks/use-integrations";
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

/**
 * Hook for connecting to GitHub via GitHub App installation flow.
 * Redirects to a server route that signs OAuth state, then forwards to GitHub.
 */
export function useGitHubAppConnect(
	options: UseGitHubAppConnectOptions = {},
): UseGitHubAppConnectReturn {
	const { onSuccess, onError, returnUrl, targetOrgId } = options;
	const disconnectMutation = useDisconnectIntegration();

	const connect = useCallback(() => {
		let installUrl = "/api/integrations/github/oauth";
		const resolvedReturnUrl =
			returnUrl ??
			(typeof window !== "undefined"
				? `${window.location.pathname}${window.location.search}`
				: undefined);

		const params = new URLSearchParams();
		if (resolvedReturnUrl) {
			params.set("returnUrl", resolvedReturnUrl);
		}
		if (targetOrgId) {
			params.set("targetOrgId", targetOrgId);
		}
		if (params.size > 0) {
			installUrl += `?${params.toString()}`;
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
