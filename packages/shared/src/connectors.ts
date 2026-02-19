/**
 * MCP Connector types and validation schemas.
 *
 * Connectors are org-scoped configurations that describe how to reach
 * a remote MCP server. The gateway resolves connector configs at runtime,
 * lists their tools, and surfaces them through the Actions pipeline.
 */

import { z } from "zod";

// ============================================
// Types
// ============================================

export type ConnectorTransport = "remote_http";

export interface ConnectorAuthBearer {
	type: "bearer";
	/** Reference to a secret key in the org secrets system (NOT a raw value). */
	secretKey: string;
}

export interface ConnectorAuthCustomHeader {
	type: "custom_header";
	/** Reference to a secret key in the org secrets system (NOT a raw value). */
	secretKey: string;
	/** HTTP header name to set (e.g., "X-Api-Key", "CONTEXT7_API_KEY"). */
	headerName: string;
}

export type ConnectorAuth = ConnectorAuthBearer | ConnectorAuthCustomHeader;

export interface ConnectorRiskPolicy {
	/** Default risk level applied to all tools from this connector. */
	defaultRisk?: "read" | "write" | "danger";
	/** Per-tool risk overrides. Key = MCP tool name, value = risk level. */
	overrides?: Record<string, "read" | "write" | "danger">;
}

export interface ConnectorConfig {
	/** Unique identifier for this connector (UUID). */
	id: string;
	/** Display name (e.g., "Notion", "Stripe"). */
	name: string;
	/** Transport type. V1 supports remote_http only. */
	transport: ConnectorTransport;
	/** MCP server endpoint URL. */
	url: string;
	/** Authentication configuration. */
	auth: ConnectorAuth;
	/** Risk policy for tool classification. */
	riskPolicy?: ConnectorRiskPolicy;
	/** Whether this connector is active. */
	enabled: boolean;
}

// ============================================
// Zod Schemas
// ============================================

const riskLevelSchema = z.enum(["read", "write", "danger"]);

const ConnectorAuthBearerSchema = z.object({
	type: z.literal("bearer"),
	secretKey: z.string().min(1).max(200),
});

const ConnectorAuthCustomHeaderSchema = z.object({
	type: z.literal("custom_header"),
	secretKey: z.string().min(1).max(200),
	headerName: z.string().min(1).max(200),
});

export const ConnectorAuthSchema = z.discriminatedUnion("type", [
	ConnectorAuthBearerSchema,
	ConnectorAuthCustomHeaderSchema,
]);

export const ConnectorRiskPolicySchema = z.object({
	defaultRisk: riskLevelSchema.optional(),
	overrides: z.record(z.string(), riskLevelSchema).optional(),
});

export const ConnectorConfigSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(100),
	transport: z.literal("remote_http"),
	url: z.string().url(),
	auth: ConnectorAuthSchema,
	riskPolicy: ConnectorRiskPolicySchema.optional(),
	enabled: z.boolean(),
});

export const ConnectorsArraySchema = z.array(ConnectorConfigSchema).max(20);

// ============================================
// Helpers
// ============================================

/**
 * Legacy helper: parse and validate raw connector JSONB from configuration storage.
 * New connector source-of-truth is org-scoped catalog persistence.
 * Returns an empty array for null, undefined, or invalid input.
 */
export function parseConfigurationConnectors(raw: unknown): ConnectorConfig[] {
	if (!raw || !Array.isArray(raw)) return [];
	const result = ConnectorsArraySchema.safeParse(raw);
	return result.success ? result.data : [];
}

// ============================================
// Connector Presets
// ============================================

export type IntegrationCategory =
	| "source-control"
	| "monitoring"
	| "project-management"
	| "communication"
	| "developer-tools"
	| "data"
	| "security"
	| "commerce"
	| "automation";

export interface ConnectorPreset {
	/** Preset identifier. */
	key: string;
	/** Display name shown in UI. */
	name: string;
	/** Short description for the catalog. */
	description: string;
	/** Pre-filled connector config (id is omitted — generated on add). */
	defaults: Omit<ConnectorConfig, "id">;
	/** Category for the integration picker. Defaults to "developer-tools". */
	category?: IntegrationCategory;
	/** Guidance text shown in the UI when this preset is selected. */
	guidance?: string;
	/** When true, preset supports the quick "API key + save" flow. */
	quickSetup?: boolean;
	/** Label for the API key input (e.g. "PostHog API key"). */
	secretLabel?: string;
	/** Recommended secret key name for auto-generation (e.g. "POSTHOG_API_KEY"). */
	recommendedSecretKey?: string;
	/** Link to provider docs for getting an API key. */
	docsUrl?: string;
}

/**
 * Look up a connector preset by its key.
 */
export function getConnectorPresetByKey(key: string): ConnectorPreset | undefined {
	return CONNECTOR_PRESETS.find((p) => p.key === key);
}

export const CONNECTOR_PRESETS: ConnectorPreset[] = [
	{
		key: "context7",
		name: "Context7",
		description: "Up-to-date documentation and code examples for any library",
		defaults: {
			name: "Context7",
			transport: "remote_http",
			url: "https://mcp.context7.com/mcp",
			auth: { type: "custom_header", secretKey: "", headerName: "CONTEXT7_API_KEY" },
			riskPolicy: { defaultRisk: "read" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Context7 API key",
		recommendedSecretKey: "CONTEXT7_API_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/context7",
	},
	{
		key: "posthog",
		name: "PostHog",
		description: "Query PostHog analytics, feature flags, and experiments",
		category: "monitoring",
		defaults: {
			name: "PostHog",
			transport: "remote_http",
			url: "https://mcp.posthog.com/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "read" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "PostHog personal API key",
		recommendedSecretKey: "POSTHOG_API_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/posthog-mcp",
	},
	{
		key: "firecrawl",
		name: "Firecrawl",
		description: "Web scraping and crawling for LLM-ready content",
		defaults: {
			name: "Firecrawl",
			transport: "remote_http",
			url: "https://mcp.firecrawl.dev/v2/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "read" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Firecrawl API key",
		recommendedSecretKey: "FIRECRAWL_API_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/firecrawl",
	},
	{
		key: "neon",
		name: "Neon",
		description: "Manage Neon Postgres databases, branches, and queries",
		category: "data",
		defaults: {
			name: "Neon",
			transport: "remote_http",
			url: "https://mcp.neon.tech/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "write" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Neon API key",
		recommendedSecretKey: "NEON_API_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/neon",
	},
	{
		key: "stripe",
		name: "Stripe",
		description: "Manage Stripe payments, customers, and subscriptions",
		category: "commerce",
		defaults: {
			name: "Stripe",
			transport: "remote_http",
			url: "https://mcp.stripe.com",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "write" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Stripe secret key",
		recommendedSecretKey: "STRIPE_SECRET_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/stripe",
	},
	{
		key: "zapier",
		name: "Zapier",
		description: "Automate workflows across 7,000+ apps with Zapier actions",
		category: "automation",
		defaults: {
			name: "Zapier",
			transport: "remote_http",
			url: "https://actions.zapier.com/mcp/",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "write" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Zapier API key",
		recommendedSecretKey: "ZAPIER_API_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/zapier",
	},
	{
		key: "supabase",
		name: "Supabase",
		description: "Manage Supabase databases, auth, storage, and edge functions",
		category: "data",
		defaults: {
			name: "Supabase",
			transport: "remote_http",
			url: "https://mcp.supabase.com",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "write" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Supabase personal access token",
		recommendedSecretKey: "SUPABASE_ACCESS_TOKEN",
		docsUrl: "https://docs.proliferate.com/integrations/supabase",
	},
	{
		key: "asana",
		name: "Asana",
		description: "Manage Asana tasks, projects, and workflows",
		category: "project-management",
		defaults: {
			name: "Asana",
			transport: "remote_http",
			url: "https://mcp.asana.com/sse",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "write" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Asana personal access token",
		recommendedSecretKey: "ASANA_ACCESS_TOKEN",
		docsUrl: "https://docs.proliferate.com/integrations/asana",
	},
	{
		key: "semgrep",
		name: "Semgrep",
		description: "Run static analysis and find security vulnerabilities in code",
		category: "security",
		defaults: {
			name: "Semgrep",
			transport: "remote_http",
			url: "https://mcp.semgrep.ai/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "read" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Semgrep API token",
		recommendedSecretKey: "SEMGREP_API_TOKEN",
		docsUrl: "https://docs.proliferate.com/integrations/semgrep",
	},
	{
		key: "deepwiki",
		name: "DeepWiki",
		description: "Search and query documentation for open-source repositories",
		defaults: {
			name: "DeepWiki",
			transport: "remote_http",
			url: "https://mcp.deepwiki.com/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "read" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "DeepWiki API key",
		recommendedSecretKey: "DEEPWIKI_API_KEY",
		docsUrl: "https://docs.proliferate.com/integrations/deepwiki",
	},
	{
		key: "apify",
		name: "Apify",
		description: "Web scraping, data extraction, and browser automation at scale",
		category: "automation",
		defaults: {
			name: "Apify",
			transport: "remote_http",
			url: "https://actors-mcp-server.apify.actor/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "write" },
			enabled: true,
		},
		quickSetup: true,
		secretLabel: "Apify API token",
		recommendedSecretKey: "APIFY_API_TOKEN",
		docsUrl: "https://docs.proliferate.com/integrations/apify",
	},
	{
		key: "custom",
		name: "Custom MCP",
		description: "Connect to any remote MCP server via HTTP",
		defaults: {
			name: "",
			transport: "remote_http",
			url: "",
			auth: { type: "bearer", secretKey: "" },
			enabled: true,
		},
	},
	{
		key: "playwright",
		name: "Playwright",
		description: "Browser automation via self-hosted Playwright MCP server",
		defaults: {
			name: "Playwright",
			transport: "remote_http",
			url: "",
			auth: { type: "bearer", secretKey: "" },
			enabled: true,
		},
		guidance:
			"Playwright MCP runs as a self-hosted HTTP server. Start it with: npx @playwright/mcp --port 8931. Then enter your server's URL above.",
	},
];
