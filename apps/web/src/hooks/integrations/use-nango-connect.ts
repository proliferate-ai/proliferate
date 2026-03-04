"use client";

import type { Provider } from "@/components/integrations/provider-icon";
import { orpc } from "@/lib/infra/orpc";
import { env } from "@proliferate/environment/public";
import { useCallback, useRef, useState } from "react";

// Feature flag for using Nango for GitHub OAuth (vs GitHub App)
export const USE_NANGO_GITHUB = env.NEXT_PUBLIC_USE_NANGO_GITHUB;

// Providers that use Nango for OAuth (excludes standalone triggers like webhook/scheduled)
export type NangoManagedProvider = "github" | "sentry" | "linear" | "jira";

// NangoProvider type excludes GitHub unless USE_NANGO_GITHUB is enabled, and always excludes standalone triggers
export type NangoProvider =
	| Exclude<NangoManagedProvider, "github">
	| (typeof USE_NANGO_GITHUB extends true ? "github" : never);

// Provider keys used for reverse lookup compatibility.
const ALL_NANGO_INTEGRATION_IDS: Record<NangoManagedProvider, string | undefined> = {
	github: "github",
	sentry: "sentry",
	linear: "linear",
	jira: "jira",
};

// Export for backward compatibility - excludes GitHub unless flag is enabled
export const NANGO_INTEGRATION_IDS = ALL_NANGO_INTEGRATION_IDS;

/**
 * Get provider type from Nango integration ID (reverse lookup)
 * Handles both configured integration IDs and fallback defaults
 */
export function getProviderFromIntegrationId(integrationId: string): NangoManagedProvider | null {
	// Check against configured integration IDs
	for (const [provider, id] of Object.entries(ALL_NANGO_INTEGRATION_IDS)) {
		if (id === integrationId) {
			return provider as NangoManagedProvider;
		}
	}
	// Fallback: check common defaults (in case integration_id in DB differs from current env)
	if (integrationId === "github-app" || integrationId === "github") return "github";
	if (integrationId.includes("sentry")) return "sentry";
	if (integrationId === "linear") return "linear";
	if (integrationId.includes("jira")) return "jira";
	return null;
}

/**
 * Check if a provider should use Nango for OAuth
 */
export function shouldUseNangoForProvider(provider: Provider): boolean {
	if (!env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
		return false;
	}
	// Standalone triggers don't use Nango
	if (provider === "webhook" || provider === "scheduled") {
		return false;
	}
	if (provider === "github") {
		return USE_NANGO_GITHUB;
	}
	// All other providers always use Nango
	return true;
}

export type NangoAuthFlow = "connectUI" | "auth";

interface UseNangoConnectOptions {
	/**
	 * Which auth flow to use:
	 * - "connectUI": Opens Nango's managed Connect UI modal
	 * - "auth" (default): Opens a headless popup directly to the provider
	 */
	flow?: NangoAuthFlow;
	onSuccess?: (provider: NangoProvider) => void;
	onError?: (provider: NangoProvider, error: unknown) => void;
}

interface UseNangoConnectReturn {
	connect: (provider: NangoProvider) => Promise<void>;
	disconnect: (provider: NangoProvider, integrationId: string) => Promise<void>;
	isLoading: boolean;
	loadingProvider: NangoProvider | null;
	error: string | null;
	isConnectUIOpen: boolean;
}

export function useNangoConnect(options: UseNangoConnectOptions = {}): UseNangoConnectReturn {
	const { onSuccess, onError } = options;
	const [loadingProvider, setLoadingProvider] = useState<NangoProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isConnectUIOpen, setIsConnectUIOpen] = useState(false);
	const connectUIRef = useRef<null>(null);

	const connect = useCallback(
		async (provider: NangoProvider) => {
			if (!env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
				throw new Error("Integrations are disabled.");
			}
			setLoadingProvider(provider);
			setError(null);

			try {
				const returnUrl = "/dashboard/integrations";
				window.location.href = `/api/integrations/${provider}/oauth?returnUrl=${encodeURIComponent(returnUrl)}`;
				onSuccess?.(provider);
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Connection failed";
				// Don't show error for user cancellation
				if (errorMessage !== "Connection cancelled") {
					setError(errorMessage);
					console.error(`Failed to connect ${provider}:`, err);
				}
				onError?.(provider, err);
			} finally {
				setLoadingProvider(null);
				setIsConnectUIOpen(false);
				connectUIRef.current = null;
			}
		},
		[onSuccess, onError],
	);

	const disconnect = useCallback(
		async (provider: NangoProvider, integrationId: string) => {
			setLoadingProvider(provider);
			setError(null);

			try {
				await orpc.integrations.disconnect.call({ integrationId });
				onSuccess?.(provider);
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Disconnect failed";
				setError(errorMessage);
				console.error(`Failed to disconnect ${provider}:`, err);
				onError?.(provider, err);
			} finally {
				setLoadingProvider(null);
			}
		},
		[onSuccess, onError],
	);

	return {
		connect,
		disconnect,
		isLoading: loadingProvider !== null,
		loadingProvider,
		error,
		isConnectUIOpen,
	};
}
