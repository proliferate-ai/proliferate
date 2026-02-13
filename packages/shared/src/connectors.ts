/**
 * MCP Connector types and validation schemas.
 *
 * Connectors are prebuild-scoped configurations that describe how to reach
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
	/** Unique identifier within this prebuild (UUID). */
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
 * Parse and validate raw JSONB connector config from the prebuilds table.
 * Returns an empty array for null, undefined, or invalid input.
 */
export function parsePrebuildConnectors(raw: unknown): ConnectorConfig[] {
	if (!raw || !Array.isArray(raw)) return [];
	const result = ConnectorsArraySchema.safeParse(raw);
	return result.success ? result.data : [];
}

// ============================================
// Connector Presets
// ============================================

export interface ConnectorPreset {
	/** Preset identifier. */
	key: string;
	/** Display name shown in UI. */
	name: string;
	/** Short description for the catalog. */
	description: string;
	/** Pre-filled connector config (id is omitted — generated on add). */
	defaults: Omit<ConnectorConfig, "id">;
	/** Guidance text shown in the UI when this preset is selected. */
	guidance?: string;
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
	},
	{
		key: "posthog",
		name: "PostHog MCP",
		description: "Query PostHog analytics, feature flags, and experiments",
		defaults: {
			name: "PostHog MCP",
			transport: "remote_http",
			url: "https://mcp.posthog.com/mcp",
			auth: { type: "bearer", secretKey: "" },
			riskPolicy: { defaultRisk: "read" },
			enabled: true,
		},
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
