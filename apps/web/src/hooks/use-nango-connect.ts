"use client";

import type { Provider } from "@/components/integrations/provider-icon";
import { orpc } from "@/lib/orpc";
import Nango from "@nangohq/frontend";
import { env } from "@proliferate/environment/public";
import { useCallback, useEffect, useRef, useState } from "react";

// Feature flag for using Nango for GitHub OAuth (vs GitHub App)
export const USE_NANGO_GITHUB = env.NEXT_PUBLIC_USE_NANGO_GITHUB;

// Providers that use Nango for OAuth (excludes standalone triggers like webhook/scheduled)
export type NangoManagedProvider = "github" | "sentry" | "linear";

// NangoProvider type excludes GitHub unless USE_NANGO_GITHUB is enabled, and always excludes standalone triggers
export type NangoProvider =
	| Exclude<NangoManagedProvider, "github">
	| (typeof USE_NANGO_GITHUB extends true ? "github" : never);

// All possible Nango integration IDs (GitHub included for when flag is enabled)
const ALL_NANGO_INTEGRATION_IDS: Record<NangoManagedProvider, string | undefined> = {
	github: env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID,
	sentry: env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID,
	linear: env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID,
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
		// Must have both the flag enabled AND the integration ID configured
		return USE_NANGO_GITHUB && !!NANGO_INTEGRATION_IDS.github;
	}
	// All other providers always use Nango
	return true;
}

export type NangoAuthFlow = "connectUI" | "auth";

// CSS class added to body when Nango Connect UI is open
// This allows us to disable pointer-events on overlays that might block the iframe
const NANGO_OPEN_CLASS = "nango-connect-open";

interface UseNangoConnectOptions {
	/**
	 * Which auth flow to use:
	 * - "connectUI" (default): Opens Nango's managed Connect UI modal (recommended)
	 * - "auth": Opens a headless popup directly to the provider
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
	const { flow = "connectUI", onSuccess, onError } = options;
	const [loadingProvider, setLoadingProvider] = useState<NangoProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isConnectUIOpen, setIsConnectUIOpen] = useState(false);
	const connectUIRef = useRef<ReturnType<Nango["openConnectUI"]> | null>(null);

	// Add/remove body class when Connect UI is open to allow CSS to disable overlay pointer-events
	useEffect(() => {
		if (isConnectUIOpen) {
			document.body.classList.add(NANGO_OPEN_CLASS);
		} else {
			document.body.classList.remove(NANGO_OPEN_CLASS);
		}
		return () => {
			document.body.classList.remove(NANGO_OPEN_CLASS);
		};
	}, [isConnectUIOpen]);

	const connect = useCallback(
		async (provider: NangoProvider) => {
			if (!env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
				throw new Error("Integrations are disabled.");
			}
			setLoadingProvider(provider);
			setError(null);

			try {
				// 1. Get session token from our backend
				const sessionProcedure = {
					github: orpc.integrations.githubSession,
					sentry: orpc.integrations.sentrySession,
					linear: orpc.integrations.linearSession,
				}[provider as NangoManagedProvider];

				if (!sessionProcedure) {
					throw new Error(`Unknown provider: ${provider}`);
				}

				const { sessionToken } = await sessionProcedure.call({});

				const nango = new Nango({ connectSessionToken: sessionToken });

				if (flow === "connectUI") {
					// NEW FLOW: Use Nango's managed Connect UI (doesn't need integrationId)
					setIsConnectUIOpen(true);
					await new Promise<void>((resolve, reject) => {
						connectUIRef.current = nango.openConnectUI({
							onEvent: async (event) => {
								if (event.type === "connect") {
									try {
										// Connection created in Nango, save to our DB
										await orpc.integrations.callback.call({
											connectionId: event.payload.connectionId,
											providerConfigKey: event.payload.providerConfigKey,
										});
										resolve();
									} catch (err) {
										reject(err);
									}
								} else if (event.type === "close") {
									// User closed the modal without completing
									reject(new Error("Connection cancelled"));
								}
							},
						});
					});
				} else {
					// OLD FLOW: Use headless auth popup (requires integrationId)
					const integrationId = NANGO_INTEGRATION_IDS[provider as NangoManagedProvider];
					if (!integrationId) {
						throw new Error(`Missing Nango integration ID for ${provider}`);
					}
					const result = await nango.auth(integrationId, {
						detectClosedAuthWindow: true,
					});

					// Save connection to our DB
					await orpc.integrations.callback.call({
						connectionId: result.connectionId,
						providerConfigKey: result.providerConfigKey,
					});
				}

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
		[flow, onSuccess, onError],
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
