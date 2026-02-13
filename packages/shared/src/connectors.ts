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
