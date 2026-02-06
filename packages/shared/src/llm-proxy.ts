/**
 * LLM Proxy utilities for generating virtual keys.
 *
 * When LLM_PROXY_URL is configured, sandboxes route LLM requests through
 * a proxy instead of direct API access. This keeps real API keys secure.
 *
 * Uses LiteLLM virtual keys (free tier) instead of JWT auth (enterprise).
 * Virtual keys are generated via the /key/generate endpoint and tracked
 * per team (org) and user (session) for spend tracking.
 */

import { env } from "@proliferate/environment/server";

export interface VirtualKeyOptions {
	/** Key validity duration (e.g., "15m", "1h", "24h"). Default: LLM_PROXY_KEY_DURATION. */
	duration?: string;
	/** Maximum budget in dollars for this key */
	maxBudget?: number;
	/** Additional metadata to attach to the key */
	metadata?: Record<string, unknown>;
}

export interface VirtualKeyResponse {
	/** The generated API key (e.g., "sk-xxx") */
	key: string;
	/** When the key expires */
	expires: string;
	/** Team ID (org) associated with the key */
	team_id: string;
	/** User ID (session) associated with the key */
	user_id: string;
}

function getDefaultVirtualKeyDuration(): string {
	return env.LLM_PROXY_KEY_DURATION ?? "24h";
}

/**
 * Generate a virtual API key for a sandbox session.
 *
 * The key is used by the sandbox to authenticate with the LLM proxy.
 * LiteLLM validates the key and tracks spend per team (org) and user (session).
 *
 * Requires:
 * - LLM_PROXY_URL: URL of the LiteLLM proxy
 * - LLM_PROXY_MASTER_KEY: Master key for key generation
 *
 * @param sessionId - Unique session identifier (becomes user_id for spend tracking)
 * @param orgId - Organization ID (becomes team_id for spend tracking)
 * @param options - Optional key configuration
 * @returns Virtual key response with the API key
 */
export async function generateVirtualKey(
	sessionId: string,
	orgId: string,
	options?: VirtualKeyOptions,
): Promise<VirtualKeyResponse> {
	const proxyUrl = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	const masterKey = env.LLM_PROXY_MASTER_KEY;
	if (!proxyUrl) {
		throw new Error("LLM_PROXY_URL is required to generate a virtual key");
	}
	if (!masterKey) {
		throw new Error("LLM_PROXY_MASTER_KEY is required to generate a virtual key");
	}

	const duration = options?.duration || getDefaultVirtualKeyDuration();

	const adminUrl = proxyUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
	const response = await fetch(`${adminUrl}/key/generate`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${masterKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			team_id: orgId,
			user_id: sessionId,
			duration,
			max_budget: options?.maxBudget,
			metadata: {
				session_id: sessionId,
				org_id: orgId,
				...options?.metadata,
			},
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to generate virtual key: ${response.status} ${error}`);
	}

	const data = (await response.json()) as {
		key: string;
		expires: string;
		team_id: string;
		user_id: string;
	};

	return {
		key: data.key,
		expires: data.expires,
		team_id: data.team_id,
		user_id: data.user_id,
	};
}

/**
 * Ensure a team (org) exists in LiteLLM for spend tracking.
 *
 * Creates the team if it doesn't exist. Teams are used for per-org spend tracking.
 * This is idempotent - calling multiple times with the same orgId is safe.
 *
 * @param orgId - Organization ID to create as a team
 * @returns Team ID (same as orgId)
 */
export async function ensureTeamExists(orgId: string): Promise<string> {
	const proxyUrl = env.LLM_PROXY_ADMIN_URL || env.LLM_PROXY_URL;
	const masterKey = env.LLM_PROXY_MASTER_KEY;
	if (!proxyUrl) {
		throw new Error("LLM_PROXY_URL is required to manage teams");
	}
	if (!masterKey) {
		throw new Error("LLM_PROXY_MASTER_KEY is required to manage teams");
	}

	const adminUrl = proxyUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

	// Try to get existing team first
	const infoResponse = await fetch(`${adminUrl}/team/info?team_id=${encodeURIComponent(orgId)}`, {
		headers: { Authorization: `Bearer ${masterKey}` },
	});

	if (infoResponse.ok) {
		return orgId; // Team already exists
	}

	// Create new team
	const createResponse = await fetch(`${adminUrl}/team/new`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${masterKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			team_id: orgId,
			team_alias: orgId,
		}),
	});

	if (!createResponse.ok) {
		// Check if it's a duplicate error (team was created between check and create)
		const error = await createResponse.text();
		if (!error.includes("already exists") && !error.includes("duplicate")) {
			throw new Error(`Failed to create team: ${createResponse.status} ${error}`);
		}
	}

	return orgId;
}

/**
 * Generate a session API key for the LLM proxy.
 *
 * This is the main entry point for session creation. It:
 * 1. Ensures the org's team exists in LiteLLM
 * 2. Generates a virtual key for the session
 *
 * Token expiry defaults to LLM_PROXY_KEY_DURATION unless overridden by options.duration.
 * When sandbox dies, token becomes useless. LLM proxy can also check session validity.
 *
 * @param sessionId - Unique session identifier
 * @param orgId - Organization ID for cost tracking
 * @param options - Optional key configuration
 * @returns The API key string to pass to the sandbox
 */
export async function generateSessionAPIKey(
	sessionId: string,
	orgId: string,
	options?: VirtualKeyOptions,
): Promise<string> {
	// Ensure team exists for spend tracking
	await ensureTeamExists(orgId);

	// Generate virtual key
	const { key } = await generateVirtualKey(sessionId, orgId, options);

	return key;
}

/**
 * Check if LLM proxy is configured.
 *
 * @returns true if LLM_PROXY_URL is set
 */
export function isLLMProxyEnabled(): boolean {
	return !!env.LLM_PROXY_URL;
}

/**
 * Get the raw LLM proxy URL exactly as configured.
 * Use this for health checks or constructing custom paths.
 *
 * @returns The proxy URL or undefined if not configured
 */
export function getLLMProxyURL(): string {
	if (!env.LLM_PROXY_URL) {
		throw new Error("LLM_PROXY_URL is not configured");
	}
	return env.LLM_PROXY_URL;
}

/**
 * Get the LLM proxy base URL for Anthropic-compatible requests.
 * Use this when configuring SDK clients that expect `/v1` in the base URL.
 *
 * Returns LLM_PROXY_URL normalized with a single `/v1` suffix
 * (trims trailing slashes, avoids double `/v1`).
 */
export function getLLMProxyBaseURL(): string | undefined {
	const baseUrl = env.LLM_PROXY_PUBLIC_URL || env.LLM_PROXY_URL;
	if (!baseUrl) return undefined;
	const trimmed = baseUrl.replace(/\/+$/, "");
	return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}
