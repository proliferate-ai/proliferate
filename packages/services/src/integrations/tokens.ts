/**
 * Integration token resolution.
 *
 * Generic interface to get OAuth tokens for any integration type.
 * Abstracts over Nango and GitHub App providers.
 */

import { Nango } from "@nangohq/node";
import { env } from "@proliferate/environment/server";
import { getDb, inArray, integrations } from "../db/client";
import { getInstallationToken } from "./github-app";

// ============================================
// Types
// ============================================

/** Integration data needed for token resolution. */
export interface IntegrationForToken {
	id: string;
	provider: string; // 'nango' | 'github-app'
	integrationId: string; // 'linear' | 'sentry' | 'github' | 'slack'
	connectionId: string;
	githubInstallationId?: string | null;
}

/** Successful token resolution. */
export interface TokenResult {
	integrationId: string;
	integrationTypeId: string; // 'linear', 'sentry', etc.
	token: string;
}

/** Failed token resolution. */
export interface TokenError {
	integrationId: string;
	message: string;
}

/** Result of resolving multiple tokens. */
export interface ResolveTokensResult {
	tokens: TokenResult[];
	errors: TokenError[];
}

// ============================================
// Nango Client
// ============================================

let nangoInstance: Nango | null = null;

function getNango(): Nango {
	if (!nangoInstance) {
		if (!env.NANGO_SECRET_KEY) {
			throw new Error("Missing NANGO_SECRET_KEY");
		}
		nangoInstance = new Nango({ secretKey: env.NANGO_SECRET_KEY });
	}
	return nangoInstance;
}

// ============================================
// Token Resolution
// ============================================

/**
 * Get OAuth token for any integration type.
 * Abstracts over Nango and GitHub App providers.
 */
export async function getToken(integration: IntegrationForToken): Promise<string> {
	// GitHub App -> installation token
	if (integration.provider === "github-app" && integration.githubInstallationId) {
		return getInstallationToken(integration.githubInstallationId);
	}

	// Nango -> OAuth token from Nango API
	if (integration.provider === "nango" && integration.connectionId) {
		const nango = getNango();
		const connection = await nango.getConnection(
			integration.integrationId,
			integration.connectionId,
		);

		const credentials = connection.credentials as { access_token?: string };
		if (!credentials.access_token) {
			throw new Error(`No access token available for integration ${integration.integrationId}`);
		}

		return credentials.access_token;
	}

	throw new Error(
		`Cannot get token for integration ${integration.id}: unsupported provider ${integration.provider}`,
	);
}

/**
 * Resolve tokens for multiple integrations.
 * Returns both successful tokens and errors for failed resolutions.
 */
export async function resolveTokens(
	integrations: IntegrationForToken[],
): Promise<ResolveTokensResult> {
	const tokens: TokenResult[] = [];
	const errors: TokenError[] = [];

	await Promise.allSettled(
		integrations.map(async (integration) => {
			try {
				const token = await getToken(integration);
				tokens.push({
					integrationId: integration.id,
					integrationTypeId: integration.integrationId,
					token,
				});
			} catch (err) {
				errors.push({
					integrationId: integration.id,
					message: err instanceof Error ? err.message : String(err),
				});
			}
		}),
	);

	return { tokens, errors };
}

/**
 * Get environment variable name for an integration token.
 * Format: {TYPE}_ACCESS_TOKEN_{short_id}
 *
 * Examples:
 * - linear + abc123 -> LINEAR_ACCESS_TOKEN_abc123
 * - sentry + def456 -> SENTRY_ACCESS_TOKEN_def456
 */
export function getEnvVarName(integrationTypeId: string, integrationId: string): string {
	const shortId = integrationId.slice(0, 8);
	return `${integrationTypeId.toUpperCase().replace(/-/g, "_")}_ACCESS_TOKEN_${shortId}`;
}

// ============================================
// Integration Lookup
// ============================================

/**
 * Get integrations by IDs with fields needed for token resolution.
 */
export async function getIntegrationsForTokens(
	integrationIds: string[],
	orgId: string,
): Promise<IntegrationForToken[]> {
	if (integrationIds.length === 0) return [];

	const db = getDb();
	const rows = await db.query.integrations.findMany({
		where: inArray(integrations.id, integrationIds),
		columns: {
			id: true,
			provider: true,
			integrationId: true,
			connectionId: true,
			githubInstallationId: true,
			organizationId: true,
			status: true,
		},
	});

	// Filter to active integrations belonging to the org
	return rows
		.filter((r) => r.organizationId === orgId && r.status === "active")
		.map((r) => ({
			id: r.id,
			provider: r.provider,
			integrationId: r.integrationId,
			connectionId: r.connectionId,
			githubInstallationId: r.githubInstallationId,
		}));
}
