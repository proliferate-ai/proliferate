import { Nango } from "@nangohq/node";
import { env } from "@proliferate/environment/server";

let nangoInstance: Nango | null = null;

export function getNango(): Nango {
	if (!nangoInstance) {
		if (!env.NEXT_PUBLIC_INTEGRATIONS_ENABLED) {
			throw new Error("Integrations are disabled. Set NEXT_PUBLIC_INTEGRATIONS_ENABLED=true.");
		}
		if (!env.NANGO_SECRET_KEY) {
			throw new Error("Missing required environment variable: NANGO_SECRET_KEY");
		}
		nangoInstance = new Nango({
			secretKey: env.NANGO_SECRET_KEY,
		});
	}
	return nangoInstance;
}

// Integration IDs - configurable via env vars (NEXT_PUBLIC_ available on both client and server)
export const NANGO_GITHUB_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID;
export const NANGO_SENTRY_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID;
export const NANGO_LINEAR_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID;

// Feature flag for using Nango for GitHub OAuth (vs GitHub App)
// Note: Uses NEXT_PUBLIC_ prefix so it's available on both client and server
export const USE_NANGO_GITHUB = env.NEXT_PUBLIC_USE_NANGO_GITHUB;

// Provider types
export type NangoProviderType = "github" | "sentry" | "linear";

// Map provider type to integration ID
export const PROVIDER_TO_INTEGRATION_ID: Record<NangoProviderType, string | undefined> = {
	github: NANGO_GITHUB_INTEGRATION_ID,
	sentry: NANGO_SENTRY_INTEGRATION_ID,
	linear: NANGO_LINEAR_INTEGRATION_ID,
};

const PROVIDER_TO_ENV_KEY: Record<NangoProviderType, string> = {
	github: "NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID",
	sentry: "NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID",
	linear: "NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID",
};

export function requireNangoIntegrationId(provider: NangoProviderType): string {
	const integrationId = PROVIDER_TO_INTEGRATION_ID[provider];
	if (!integrationId) {
		throw new Error(`Missing ${PROVIDER_TO_ENV_KEY[provider]} while integrations are enabled.`);
	}
	return integrationId;
}

// Map integration ID to provider type (reverse lookup)
// Built dynamically so it stays in sync with the env vars
export function getProviderFromIntegrationId(integrationId: string): NangoProviderType | null {
	if (integrationId === NANGO_GITHUB_INTEGRATION_ID || integrationId === "github") {
		return "github";
	}
	if (integrationId === NANGO_SENTRY_INTEGRATION_ID || integrationId === "sentry") {
		return "sentry";
	}
	if (integrationId === NANGO_LINEAR_INTEGRATION_ID || integrationId === "linear") {
		return "linear";
	}
	return null;
}

export default getNango;
