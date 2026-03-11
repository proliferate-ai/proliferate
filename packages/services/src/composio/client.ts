/**
 * Composio REST client.
 *
 * Thin wrapper around Composio's v3 API. Uses fetch() directly,
 * matching the pattern established in packages/triggers/src/service/adapters/gmail.ts.
 *
 * No SDK dependency — only HTTP calls gated on COMPOSIO_API_KEY.
 */

import { getServicesLogger } from "../logger";

const log = getServicesLogger().child({ module: "composio-client" });

const REQUEST_TIMEOUT_MS = 10_000;

export interface ComposioClientConfig {
	apiKey: string;
	baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://backend.composio.dev";

function getBaseUrl(config: ComposioClientConfig): string {
	return config.baseUrl || DEFAULT_BASE_URL;
}

function headers(config: ComposioClientConfig): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"x-api-key": config.apiKey,
	};
}

// ============================================
// Initiate OAuth
// ============================================

export interface InitiateOAuthInput {
	toolkit: string;
	orgId: string;
	callbackUrl: string;
}

export interface InitiateOAuthResult {
	redirectUrl: string;
	connectedAccountId: string;
}

/**
 * Initiate an OAuth flow for a Composio toolkit.
 * Returns the redirect URL to send the user to, and the pending connected account ID.
 */
export async function initiateOAuth(
	config: ComposioClientConfig,
	input: InitiateOAuthInput,
): Promise<InitiateOAuthResult> {
	const response = await fetch(`${getBaseUrl(config)}/api/v3/connected_accounts`, {
		method: "POST",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		body: JSON.stringify({
			integration_id: input.toolkit,
			user_id: input.orgId,
			redirect_url: input.callbackUrl,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Composio OAuth initiation failed (${response.status}): ${text}`);
	}

	const json = (await response.json()) as {
		data?: {
			redirectUrl?: string;
			connectedAccountId?: string;
			id?: string;
			redirect_url?: string;
		};
		redirectUrl?: string;
		connectedAccountId?: string;
		id?: string;
		redirect_url?: string;
	};
	const data = json.data ?? json;

	const redirectUrl = data.redirectUrl || data.redirect_url;
	const connectedAccountId = data.connectedAccountId || data.id;

	if (!redirectUrl || !connectedAccountId) {
		throw new Error("Composio OAuth initiation returned incomplete data");
	}

	return { redirectUrl, connectedAccountId };
}

// ============================================
// Get Connected Account
// ============================================

export interface ComposioConnectedAccount {
	id: string;
	status: string;
	integrationId?: string;
	userId?: string;
}

/**
 * Fetch a Composio connected account by ID.
 */
export async function getConnectedAccount(
	config: ComposioClientConfig,
	connectedAccountId: string,
): Promise<ComposioConnectedAccount> {
	const response = await fetch(
		`${getBaseUrl(config)}/api/v3/connected_accounts/${connectedAccountId}`,
		{
			method: "GET",
			headers: headers(config),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		},
	);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Composio account fetch failed (${response.status}): ${text}`);
	}

	const json = (await response.json()) as { data?: Record<string, unknown> } & Record<
		string,
		unknown
	>;
	const data = (json.data ?? json) as Record<string, unknown>;

	return {
		id: (data.id ?? data.connectedAccountId ?? connectedAccountId) as string,
		status: (data.status ?? "unknown") as string,
		integrationId: (data.integrationId ?? data.integration_id) as string | undefined,
		userId: (data.userId ?? data.user_id) as string | undefined,
	};
}

// ============================================
// Delete Connected Account
// ============================================

/**
 * Delete a Composio connected account. Best-effort — logs on failure.
 */
export async function deleteConnectedAccount(
	config: ComposioClientConfig,
	connectedAccountId: string,
): Promise<void> {
	try {
		const response = await fetch(
			`${getBaseUrl(config)}/api/v3/connected_accounts/${connectedAccountId}`,
			{
				method: "DELETE",
				headers: headers(config),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			log.warn(
				{ connectedAccountId, status: response.status, body: text },
				"Failed to delete Composio connected account",
			);
		}
	} catch (err) {
		log.warn({ err, connectedAccountId }, "Error deleting Composio connected account");
	}
}

// ============================================
// Get or Create MCP Server
// ============================================

export interface GetOrCreateMcpServerInput {
	toolkit: string;
	orgId: string;
}

export interface GetOrCreateMcpServerResult {
	mcpUrl: string;
}

/**
 * Get or create a per-toolkit MCP server in Composio.
 * Returns a stable MCP URL with the org's user_id baked in.
 */
export async function getOrCreateMcpServer(
	config: ComposioClientConfig,
	input: GetOrCreateMcpServerInput,
): Promise<GetOrCreateMcpServerResult> {
	const response = await fetch(`${getBaseUrl(config)}/api/v3/mcp`, {
		method: "POST",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		body: JSON.stringify({
			toolkit: input.toolkit,
			user_id: input.orgId,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Composio MCP server creation failed (${response.status}): ${text}`);
	}

	const json = (await response.json()) as { data?: { url?: string }; url?: string };
	const mcpUrl = json.data?.url ?? json.url;

	if (!mcpUrl) {
		throw new Error("Composio MCP server creation returned no URL");
	}

	return { mcpUrl };
}
