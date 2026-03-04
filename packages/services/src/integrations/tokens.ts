/**
 * Integration token resolution.
 *
 * Generic interface to get OAuth tokens for any integration type.
 * Abstracts over provider-native OAuth apps and GitHub App providers.
 */

import { env } from "@proliferate/environment/server";
import { decrypt, encrypt, getEncryptionKey } from "../db/crypto";
import { findManyForTokens, updateOAuthCredentials } from "./db";
import { getInstallationToken } from "./github-app";

// ============================================
// Types
// ============================================

/** Integration data needed for token resolution. */
export interface IntegrationForToken {
	id: string;
	provider: string; // 'oauth-app' | 'github-app' | legacy 'nango'
	integrationId: string; // 'linear' | 'sentry' | 'github' | 'slack'
	connectionId: string;
	organizationId?: string;
	status?: string | null;
	githubInstallationId?: string | null;
	encryptedAccessToken?: string | null;
	encryptedRefreshToken?: string | null;
	tokenExpiresAt?: Date | null;
	tokenType?: string | null;
	connectionMetadata?: Record<string, unknown> | null;
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

	if (integration.provider === "oauth-app") {
		return getOAuthAppToken(integration);
	}

	throw new Error(
		`Cannot get token for integration ${integration.id}: unsupported provider ${integration.provider}`,
	);
}

function isExpiringSoon(tokenExpiresAt: Date | null | undefined): boolean {
	if (!tokenExpiresAt) return false;
	return tokenExpiresAt.getTime() <= Date.now() + 60_000;
}

async function refreshOAuthToken(integration: IntegrationForToken): Promise<{
	accessToken: string;
	refreshToken: string | null;
	expiresAt: Date | null;
	tokenType: string | null;
	connectionMetadata?: Record<string, unknown> | null;
}> {
	const encryptionKey = getEncryptionKey();
	const encryptedRefreshToken = integration.encryptedRefreshToken;
	if (!encryptedRefreshToken) {
		throw new Error(`Missing refresh token for integration ${integration.id}`);
	}
	const refreshToken = decrypt(encryptedRefreshToken, encryptionKey);

	switch (integration.integrationId) {
		case "sentry": {
			const clientId = env.SENTRY_OAUTH_CLIENT_ID;
			const clientSecret = env.SENTRY_OAUTH_CLIENT_SECRET;
			if (!clientId || !clientSecret) {
				throw new Error("Missing Sentry OAuth app credentials");
			}

			const body = new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			});
			const response = await fetch("https://sentry.io/oauth/token/", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body,
			});
			if (!response.ok) {
				throw new Error(`Sentry token refresh failed (${response.status})`);
			}
			const payload = (await response.json()) as {
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
				token_type?: string;
			};
			return {
				accessToken: payload.access_token,
				refreshToken: payload.refresh_token ?? refreshToken,
				expiresAt:
					typeof payload.expires_in === "number"
						? new Date(Date.now() + payload.expires_in * 1000)
						: null,
				tokenType: payload.token_type ?? "bearer",
			};
		}
		case "linear": {
			const clientId = env.LINEAR_OAUTH_CLIENT_ID;
			const clientSecret = env.LINEAR_OAUTH_CLIENT_SECRET;
			if (!clientId || !clientSecret) {
				throw new Error("Missing Linear OAuth app credentials");
			}

			const body = new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: clientId,
				client_secret: clientSecret,
			});
			const response = await fetch("https://api.linear.app/oauth/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body,
			});
			if (!response.ok) {
				throw new Error(`Linear token refresh failed (${response.status})`);
			}
			const payload = (await response.json()) as {
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
				token_type?: string;
			};
			return {
				accessToken: payload.access_token,
				refreshToken: payload.refresh_token ?? refreshToken,
				expiresAt:
					typeof payload.expires_in === "number"
						? new Date(Date.now() + payload.expires_in * 1000)
						: null,
				tokenType: payload.token_type ?? "Bearer",
			};
		}
		case "jira": {
			const clientId = env.JIRA_OAUTH_CLIENT_ID;
			const clientSecret = env.JIRA_OAUTH_CLIENT_SECRET;
			if (!clientId || !clientSecret) {
				throw new Error("Missing Jira OAuth app credentials");
			}

			const response = await fetch("https://auth.atlassian.com/oauth/token", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "refresh_token",
					client_id: clientId,
					client_secret: clientSecret,
					refresh_token: refreshToken,
				}),
			});
			if (!response.ok) {
				throw new Error(`Jira token refresh failed (${response.status})`);
			}
			const payload = (await response.json()) as {
				access_token: string;
				refresh_token?: string;
				expires_in?: number;
				token_type?: string;
			};
			// Atlassian uses rotating refresh tokens; replace with returned value when provided.
			return {
				accessToken: payload.access_token,
				refreshToken: payload.refresh_token ?? refreshToken,
				expiresAt:
					typeof payload.expires_in === "number"
						? new Date(Date.now() + payload.expires_in * 1000)
						: null,
				tokenType: payload.token_type ?? "Bearer",
			};
		}
		default:
			throw new Error(`Unsupported OAuth provider: ${integration.integrationId}`);
	}
}

async function getOAuthAppToken(integration: IntegrationForToken): Promise<string> {
	const encryptionKey = getEncryptionKey();
	if (!integration.encryptedAccessToken) {
		throw new Error(`Missing encrypted access token for integration ${integration.id}`);
	}

	if (!isExpiringSoon(integration.tokenExpiresAt ?? null)) {
		return decrypt(integration.encryptedAccessToken, encryptionKey);
	}

	const refreshed = await refreshOAuthToken(integration);
	await updateOAuthCredentials(integration.id, {
		encryptedAccessToken: encrypt(refreshed.accessToken, encryptionKey),
		encryptedRefreshToken: refreshed.refreshToken
			? encrypt(refreshed.refreshToken, encryptionKey)
			: null,
		tokenExpiresAt: refreshed.expiresAt,
		tokenType: refreshed.tokenType,
		connectionMetadata: refreshed.connectionMetadata,
	});
	return refreshed.accessToken;
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

	const rows = await findManyForTokens(integrationIds);

	// Filter to active integrations belonging to the org
	return rows
		.filter((r) => r.organizationId === orgId && r.status === "active")
		.map((r) => ({
			id: r.id,
			provider: r.provider,
			integrationId: r.integrationId,
			connectionId: r.connectionId,
			organizationId: r.organizationId,
			status: r.status,
			githubInstallationId: r.githubInstallationId,
			encryptedAccessToken: r.encryptedAccessToken,
			encryptedRefreshToken: r.encryptedRefreshToken,
			tokenExpiresAt: r.tokenExpiresAt,
			tokenType: r.tokenType,
			connectionMetadata: (r.connectionMetadata as Record<string, unknown> | null) ?? null,
		}));
}
