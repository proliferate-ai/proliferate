/**
 * Shared Nango client factory for the services package.
 *
 * Consolidates the Nango singleton that was previously duplicated in
 * `apps/web/src/lib/nango.ts` and `integrations/tokens.ts`.
 */

import { Nango } from "@nangohq/node";
import { env } from "@proliferate/environment/server";

// ============================================
// Nango Client Singleton
// ============================================

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

// ============================================
// Provider Types & Integration ID Resolution
// ============================================

export type NangoProviderType = "github" | "sentry" | "linear" | "jira";

const PROVIDER_TO_ENV_KEY: Record<NangoProviderType, string> = {
	github: "NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID",
	sentry: "NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID",
	linear: "NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID",
	jira: "NEXT_PUBLIC_NANGO_JIRA_INTEGRATION_ID",
};

function getProviderIntegrationIds(): Record<NangoProviderType, string | undefined> {
	return {
		github: env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID,
		sentry: env.NEXT_PUBLIC_NANGO_SENTRY_INTEGRATION_ID,
		linear: env.NEXT_PUBLIC_NANGO_LINEAR_INTEGRATION_ID,
		jira: env.NEXT_PUBLIC_NANGO_JIRA_INTEGRATION_ID,
	};
}

export function requireNangoIntegrationId(provider: NangoProviderType): string {
	const integrationId = getProviderIntegrationIds()[provider];
	if (!integrationId) {
		throw new Error(`Missing ${PROVIDER_TO_ENV_KEY[provider]} while integrations are enabled.`);
	}
	return integrationId;
}

export function getNangoIntegrationId(provider: NangoProviderType): string | undefined {
	return getProviderIntegrationIds()[provider];
}
