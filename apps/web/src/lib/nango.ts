import { env } from "@proliferate/environment/server";

// Re-export the shared Nango client and utilities from services
export { getNango, requireNangoIntegrationId } from "@proliferate/services/nango";
export type { NangoProviderType } from "@proliferate/services/nango";

// Integration IDs - configurable via env vars (NEXT_PUBLIC_ available on both client and server)
export const NANGO_GITHUB_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID;
export const NANGO_SENTRY_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID;
export const NANGO_LINEAR_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID;
export const NANGO_JIRA_INTEGRATION_ID = env.NEXT_PUBLIC_NANGO_JIRA_INTEGRATION_ID;

// Feature flag for using Nango for GitHub OAuth (vs GitHub App)
// Note: Uses NEXT_PUBLIC_ prefix so it's available on both client and server
export const USE_NANGO_GITHUB = env.NEXT_PUBLIC_USE_NANGO_GITHUB;

// Map provider type to integration ID
export const PROVIDER_TO_INTEGRATION_ID: Record<string, string | undefined> = {
	github: NANGO_GITHUB_INTEGRATION_ID,
	sentry: NANGO_SENTRY_INTEGRATION_ID,
	linear: NANGO_LINEAR_INTEGRATION_ID,
	jira: NANGO_JIRA_INTEGRATION_ID,
};

// Map integration ID to provider type (reverse lookup)
// Built dynamically so it stays in sync with the env vars
export function getProviderFromIntegrationId(integrationId: string): "github" | "sentry" | "linear" | "jira" | null {
	if (integrationId === NANGO_GITHUB_INTEGRATION_ID || integrationId === "github") {
		return "github";
	}
	if (integrationId === NANGO_SENTRY_INTEGRATION_ID || integrationId === "sentry") {
		return "sentry";
	}
	if (integrationId === NANGO_LINEAR_INTEGRATION_ID || integrationId === "linear") {
		return "linear";
	}
	if (integrationId === NANGO_JIRA_INTEGRATION_ID || integrationId === "jira") {
		return "jira";
	}
	return null;
}

export { getNango as default } from "@proliferate/services/nango";
