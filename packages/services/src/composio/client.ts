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

type JsonRecord = Record<string, unknown>;

interface ComposioAuthConfig {
	id: string;
	toolkitSlug?: string;
	status?: string;
	authScheme?: string;
	isComposioManaged?: boolean;
}

interface ComposioMcpServer {
	id: string;
	name?: string;
	toolkits: string[];
	authConfigIds: string[];
	managedAuthViaComposio?: boolean;
	mcpUrl?: string;
}

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

function asRecord(value: unknown): JsonRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	return value as JsonRecord;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return undefined;
}

function parseStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseToolkitSlug(value: unknown): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}

	return firstString(asRecord(value)?.slug);
}

function parseAuthConfig(record: JsonRecord): ComposioAuthConfig | undefined {
	const id = firstString(record.id, record.auth_config_id, record.authConfigId);
	if (!id) return undefined;

	return {
		id,
		toolkitSlug: parseToolkitSlug(record.toolkit) ?? firstString(record.app_name, record.appName),
		status: firstString(record.status),
		authScheme: firstString(record.auth_scheme, record.authScheme),
		isComposioManaged:
			typeof record.is_composio_managed === "boolean"
				? record.is_composio_managed
				: typeof record.isComposioManaged === "boolean"
					? record.isComposioManaged
					: undefined,
	};
}

function parseMcpServer(record: JsonRecord): ComposioMcpServer | undefined {
	const id = firstString(record.id, record.mcp_server_id, record.mcpServerId);
	if (!id) return undefined;

	return {
		id,
		name: firstString(record.name),
		toolkits: parseStringArray(record.toolkits),
		authConfigIds: parseStringArray(record.auth_config_ids ?? record.authConfigIds),
		managedAuthViaComposio:
			typeof record.managed_auth_via_composio === "boolean"
				? record.managed_auth_via_composio
				: typeof record.managedAuthViaComposio === "boolean"
					? record.managedAuthViaComposio
					: undefined,
		mcpUrl: firstString(record.mcp_url, record.mcpUrl),
	};
}

function unwrapList(json: JsonRecord): JsonRecord[] {
	const raw = Array.isArray(json.items) ? json.items : Array.isArray(json.data) ? json.data : [];
	return raw.map((item) => asRecord(item)).filter((item): item is JsonRecord => !!item);
}

function pickAuthConfig(
	authConfigs: ComposioAuthConfig[],
	toolkit: string,
): ComposioAuthConfig | undefined {
	const toolkitLower = toolkit.toLowerCase();

	return authConfigs
		.filter((authConfig) => authConfig.toolkitSlug?.toLowerCase() === toolkitLower)
		.sort((left, right) => scoreAuthConfig(right) - scoreAuthConfig(left))[0];
}

function scoreAuthConfig(authConfig: ComposioAuthConfig): number {
	let score = 0;
	if (authConfig.status?.toUpperCase() === "ENABLED") score += 4;
	if (authConfig.authScheme?.toUpperCase() === "OAUTH2") score += 2;
	if (authConfig.isComposioManaged) score += 1;
	return score;
}

async function listAuthConfigs(
	config: ComposioClientConfig,
	toolkit: string,
): Promise<ComposioAuthConfig[]> {
	const url = new URL(`${getBaseUrl(config)}/api/v3/auth_configs`);
	url.searchParams.set("toolkit_slug", toolkit);
	url.searchParams.set("is_composio_managed", "true");
	url.searchParams.set("show_disabled", "false");
	url.searchParams.set("limit", "100");

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Failed to list Composio auth configs for ${toolkit} (${response.status}): ${text}`,
		);
	}

	const json = (await response.json()) as JsonRecord;
	return unwrapList(json)
		.map(parseAuthConfig)
		.filter((item): item is ComposioAuthConfig => !!item);
}

async function createManagedAuthConfig(
	config: ComposioClientConfig,
	toolkit: string,
): Promise<string> {
	const response = await fetch(`${getBaseUrl(config)}/api/v3/auth_configs`, {
		method: "POST",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		body: JSON.stringify({
			toolkit: { slug: toolkit },
			auth_config: {
				auth_scheme: "OAUTH2",
				is_composio_managed: true,
			},
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Failed to create Composio auth config for ${toolkit} (${response.status}): ${text}`,
		);
	}

	const json = (await response.json()) as JsonRecord;
	const data = asRecord(json.data) ?? json;
	const nestedAuthConfig = asRecord(data.auth_config) ?? asRecord(json.auth_config);
	const authConfigId = firstString(
		nestedAuthConfig?.id,
		data.auth_config_id,
		data.authConfigId,
		json.auth_config_id,
		json.authConfigId,
		data.id,
		json.id,
	);

	if (!authConfigId) {
		throw new Error(`Composio auth config creation for ${toolkit} returned no auth config ID`);
	}

	return authConfigId;
}

async function resolveAuthConfigId(config: ComposioClientConfig, toolkit: string): Promise<string> {
	const existing = pickAuthConfig(await listAuthConfigs(config, toolkit), toolkit);
	if (existing) {
		return existing.id;
	}

	try {
		return await createManagedAuthConfig(config, toolkit);
	} catch (error) {
		const afterRace = pickAuthConfig(await listAuthConfigs(config, toolkit), toolkit);
		if (afterRace) {
			return afterRace.id;
		}
		throw error;
	}
}

function pickMcpServer(
	servers: ComposioMcpServer[],
	toolkit: string,
	authConfigId: string,
): ComposioMcpServer | undefined {
	const toolkitLower = toolkit.toLowerCase();

	return servers.find((server) => {
		const hasToolkit = server.toolkits.some((item) => item.toLowerCase() === toolkitLower);
		const hasAuthConfig = server.authConfigIds.includes(authConfigId);
		const isManaged = server.managedAuthViaComposio !== false;
		return hasToolkit && hasAuthConfig && isManaged;
	});
}

async function listMcpServers(
	config: ComposioClientConfig,
	toolkit: string,
	authConfigId: string,
): Promise<ComposioMcpServer[]> {
	const url = new URL(`${getBaseUrl(config)}/api/v3/mcp/servers`);
	url.searchParams.set("toolkits", toolkit);
	url.searchParams.set("auth_config_ids", authConfigId);
	url.searchParams.set("order_by", "updated_at");
	url.searchParams.set("order_direction", "desc");
	url.searchParams.set("limit", "100");

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Failed to list Composio MCP servers for ${toolkit} (${response.status}): ${text}`,
		);
	}

	const json = (await response.json()) as JsonRecord;
	return unwrapList(json)
		.map(parseMcpServer)
		.filter((item): item is ComposioMcpServer => !!item);
}

function buildMcpServerName(toolkit: string, authConfigId: string): string {
	const suffix = authConfigId.replace(/[^a-z0-9-]/gi, "").slice(-8) || "default";
	return `pfl-${toolkit}-${suffix}`;
}

async function createManagedMcpServer(
	config: ComposioClientConfig,
	toolkit: string,
	authConfigId: string,
): Promise<ComposioMcpServer> {
	const response = await fetch(`${getBaseUrl(config)}/api/v3/mcp/servers/custom`, {
		method: "POST",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		body: JSON.stringify({
			name: buildMcpServerName(toolkit, authConfigId),
			toolkits: [toolkit],
			auth_config_ids: [authConfigId],
			managed_auth_via_composio: true,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Failed to create Composio MCP server for ${toolkit} (${response.status}): ${text}`,
		);
	}

	const json = (await response.json()) as JsonRecord;
	const server = parseMcpServer(asRecord(json.data) ?? json);
	if (!server) {
		throw new Error(`Composio MCP server creation for ${toolkit} returned no server ID`);
	}

	return server;
}

async function resolveMcpServerId(
	config: ComposioClientConfig,
	toolkit: string,
	authConfigId: string,
): Promise<string> {
	const existing = pickMcpServer(
		await listMcpServers(config, toolkit, authConfigId),
		toolkit,
		authConfigId,
	);
	if (existing) {
		return existing.id;
	}

	try {
		return (await createManagedMcpServer(config, toolkit, authConfigId)).id;
	} catch (error) {
		const afterRace = pickMcpServer(
			await listMcpServers(config, toolkit, authConfigId),
			toolkit,
			authConfigId,
		);
		if (afterRace) {
			return afterRace.id;
		}
		throw error;
	}
}

async function generateMcpUrl(
	config: ComposioClientConfig,
	serverId: string,
	orgId: string,
	connectedAccountId?: string,
): Promise<string> {
	const response = await fetch(`${getBaseUrl(config)}/api/v3/mcp/servers/generate`, {
		method: "POST",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		body: JSON.stringify({
			mcp_server_id: serverId,
			managed_auth_by_composio: true,
			user_ids: [orgId],
			...(connectedAccountId ? { connected_account_ids: [connectedAccountId] } : {}),
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Composio MCP URL generation failed (${response.status}): ${text}`);
	}

	const json = (await response.json()) as JsonRecord;
	const data = asRecord(json.data) ?? json;
	const userUrls = parseStringArray(data.user_ids_url ?? data.userIdsUrl);
	const connectedAccountUrls = parseStringArray(
		data.connected_account_urls ?? data.connectedAccountUrls,
	);
	const baseMcpUrl = firstString(data.mcp_url, data.mcpUrl);

	const mcpUrl =
		userUrls[0] ??
		connectedAccountUrls[0] ??
		(baseMcpUrl
			? `${baseMcpUrl}${baseMcpUrl.includes("?") ? "&" : "?"}user_id=${encodeURIComponent(orgId)}`
			: undefined);

	if (!mcpUrl) {
		throw new Error("Composio MCP URL generation returned no MCP URL");
	}

	return mcpUrl;
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
	const authConfigId = await resolveAuthConfigId(config, input.toolkit);

	const response = await fetch(`${getBaseUrl(config)}/api/v3/connected_accounts/link`, {
		method: "POST",
		headers: headers(config),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		body: JSON.stringify({
			auth_config_id: authConfigId,
			user_id: input.orgId,
			callback_url: input.callbackUrl,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Composio OAuth initiation failed (${response.status}): ${text}`);
	}

	const json = (await response.json()) as JsonRecord;
	const data = asRecord(json.data) ?? json;
	const redirectUrl = firstString(
		data.redirect_url,
		data.redirectUrl,
		data.auth_link,
		data.authLink,
	);
	const connectedAccountId = firstString(
		data.connected_account_id,
		data.connectedAccountId,
		data.connection_request_id,
		data.connectionRequestId,
		data.id,
	);

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
	authConfigId?: string;
	integrationId?: string;
	toolkitSlug?: string;
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

	const json = (await response.json()) as JsonRecord;
	const data = json;
	const nested = asRecord(json.data);
	const authConfig = asRecord(data.auth_config) ?? asRecord(nested?.auth_config);

	return {
		id:
			firstString(
				data.id,
				nested?.id,
				data.connectedAccountId,
				nested?.connectedAccountId,
				connectedAccountId,
			) ?? connectedAccountId,
		status: firstString(data.status, nested?.status) ?? "unknown",
		authConfigId: firstString(
			authConfig?.id,
			data.auth_config_id,
			data.authConfigId,
			nested?.auth_config_id,
			nested?.authConfigId,
		),
		integrationId: firstString(
			data.integrationId,
			data.integration_id,
			nested?.integrationId,
			nested?.integration_id,
		),
		toolkitSlug:
			parseToolkitSlug(data.toolkit) ??
			parseToolkitSlug(nested?.toolkit) ??
			firstString(data.app_name, data.appName, nested?.app_name, nested?.appName),
		userId: firstString(data.userId, data.user_id, nested?.userId, nested?.user_id),
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
	authConfigId?: string;
	connectedAccountId?: string;
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
	const authConfigId = input.authConfigId ?? (await resolveAuthConfigId(config, input.toolkit));
	const serverId = await resolveMcpServerId(config, input.toolkit, authConfigId);
	const mcpUrl = await generateMcpUrl(config, serverId, input.orgId, input.connectedAccountId);

	return { mcpUrl };
}
