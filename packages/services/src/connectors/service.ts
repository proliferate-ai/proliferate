/**
 * Org-scoped connector service layer.
 *
 * Business logic for org-level MCP connector management.
 */

import type { ConnectorAuth, ConnectorConfig, ConnectorRiskPolicy } from "@proliferate/shared";
import { getConnectorPresetByKey } from "@proliferate/shared";
import { listConnectorToolsOrThrow } from "../actions/connectors/client";
import { encrypt, getEncryptionKey } from "../db/crypto";
import { resolveSecretValue } from "../secrets/service";

import * as db from "./db";

// ============================================
// Types
// ============================================

export interface CreateConnectorInput {
	organizationId: string;
	name: string;
	transport: "remote_http";
	url: string;
	auth: ConnectorAuth;
	riskPolicy?: ConnectorRiskPolicy;
	enabled: boolean;
	createdBy: string;
}

export interface UpdateConnectorInput {
	name?: string;
	url?: string;
	auth?: ConnectorAuth;
	riskPolicy?: ConnectorRiskPolicy | null;
	enabled?: boolean;
}

export type ConnectorValidationDiagnosticClass =
	| "auth"
	| "timeout"
	| "unreachable"
	| "protocol"
	| "unknown";

export interface ConnectorValidationToolParam {
	name: string;
	type: "string" | "number" | "boolean" | "object";
	required: boolean;
	description: string;
}

export interface ConnectorValidationTool {
	name: string;
	description: string;
	riskLevel: "read" | "write" | "danger";
	params: ConnectorValidationToolParam[];
}

export interface ConnectorValidationResult {
	ok: boolean;
	tools: ConnectorValidationTool[];
	error: string | null;
	diagnostics: {
		class: ConnectorValidationDiagnosticClass;
		message: string;
	} | null;
}

// ============================================
// Mappers
// ============================================

/**
 * Map a DB row to a ConnectorConfig (the shared type used everywhere).
 */
export function toConnectorConfig(row: db.OrgConnectorRow): ConnectorConfig {
	return {
		id: row.id,
		name: row.name,
		transport: row.transport as "remote_http",
		url: row.url,
		auth: row.auth as ConnectorAuth,
		riskPolicy: (row.riskPolicy as ConnectorRiskPolicy) ?? undefined,
		enabled: row.enabled,
	};
}

// ============================================
// Operations
// ============================================

/**
 * List all connectors for an organization (as ConnectorConfig[]).
 */
export async function listConnectors(organizationId: string): Promise<ConnectorConfig[]> {
	const rows = await db.listByOrg(organizationId);
	return rows.map(toConnectorConfig);
}

/**
 * List enabled connectors for an organization (as ConnectorConfig[]).
 */
export async function listEnabledConnectors(organizationId: string): Promise<ConnectorConfig[]> {
	const rows = await db.listEnabledByOrg(organizationId);
	return rows.map(toConnectorConfig);
}

/**
 * Get a single connector by ID (with org check).
 */
export async function getConnector(
	id: string,
	organizationId: string,
): Promise<ConnectorConfig | null> {
	const row = await db.findByIdAndOrg(id, organizationId);
	return row ? toConnectorConfig(row) : null;
}

/**
 * Get stored tool_risk_overrides for a connector (used for drift detection).
 * Returns null if the connector doesn't exist or has no overrides.
 */
export async function getToolRiskOverrides(
	id: string,
	organizationId: string,
): Promise<Record<string, { mode?: string; hash?: string }> | null> {
	const row = await db.findByIdAndOrg(id, organizationId);
	return (row?.toolRiskOverrides as Record<string, { mode?: string; hash?: string }>) ?? null;
}

/**
 * Create a new org connector.
 */
export async function createConnector(input: CreateConnectorInput): Promise<ConnectorConfig> {
	const row = await db.create({
		organizationId: input.organizationId,
		name: input.name,
		transport: input.transport,
		url: input.url,
		auth: input.auth,
		riskPolicy: input.riskPolicy,
		enabled: input.enabled,
		createdBy: input.createdBy,
	});
	return toConnectorConfig(row);
}

/**
 * Update an existing org connector.
 */
export async function updateConnector(
	id: string,
	organizationId: string,
	input: UpdateConnectorInput,
): Promise<ConnectorConfig | null> {
	const row = await db.update(id, organizationId, {
		name: input.name,
		url: input.url,
		auth: input.auth,
		riskPolicy: input.riskPolicy,
		enabled: input.enabled,
	});
	return row ? toConnectorConfig(row) : null;
}

/**
 * Delete an org connector.
 */
export async function deleteConnector(id: string, organizationId: string): Promise<boolean> {
	return db.deleteById(id, organizationId);
}

/**
 * Resolve secret and validate connector by calling MCP tools/list.
 */
export async function validateConnector(
	organizationId: string,
	connector: ConnectorConfig,
): Promise<ConnectorValidationResult> {
	const resolvedSecret = await resolveSecretValue(organizationId, connector.auth.secretKey);
	if (!resolvedSecret) {
		return {
			ok: false,
			tools: [],
			error: `Secret "${connector.auth.secretKey}" not found or could not be decrypted`,
			diagnostics: { class: "auth", message: "Secret not found" },
		};
	}

	try {
		const result = await listConnectorToolsOrThrow(connector, resolvedSecret);
		if (result.actions.length === 0) {
			return {
				ok: false,
				tools: [],
				error: "Connected successfully but no tools were returned",
				diagnostics: {
					class: "protocol",
					message: "Server returned zero tools from tools/list",
				},
			};
		}

		const { zodToJsonSchema } = await import("@proliferate/providers/helpers/schema");
		const tools: ConnectorValidationTool[] = result.actions.map((action) => {
			const schema = zodToJsonSchema(action.params);
			const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
			const requiredSet = new Set(
				Array.isArray(schema.required) ? (schema.required as string[]) : [],
			);
			return {
				name: action.id,
				description: action.description,
				riskLevel: action.riskLevel,
				params: Object.entries(properties).map(([name, property]) => {
					const t = property.type as string;
					const type: "string" | "number" | "boolean" | "object" =
						t === "string"
							? "string"
							: t === "number"
								? "number"
								: t === "boolean"
									? "boolean"
									: "object";
					return {
						name,
						type,
						required: requiredSet.has(name),
						description: (property.description as string) ?? "",
					};
				}),
			};
		});

		return {
			ok: true,
			tools,
			error: null,
			diagnostics: null,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			tools: [],
			error: message,
			diagnostics: {
				class: classifyConnectorValidationError(message),
				message,
			},
		};
	}
}

// ============================================
// Atomic connector + secret provisioning
// ============================================

export interface CreateConnectorWithSecretInput {
	organizationId: string;
	createdBy: string;
	/** Preset key from CONNECTOR_PRESETS (e.g. "posthog", "context7"). */
	presetKey: string;
	/** Raw secret value (plaintext API key). Omit to reuse an existing secret. */
	secretValue?: string;
	/** Optional override for the secret key name. */
	secretKey?: string;
	/** Optional connector name override. */
	name?: string;
	/** Optional URL override. */
	url?: string;
	/** Optional risk policy override. */
	riskPolicy?: ConnectorRiskPolicy;
}

export interface CreateConnectorWithSecretResult {
	connector: ConnectorConfig;
	/** The actual secret key used (may differ from input if suffixed). */
	resolvedSecretKey: string;
}

/**
 * Atomically create an org secret and connector from a preset.
 *
 * If secretValue is provided, a new secret is created (auto-suffixed on collision).
 * If secretValue is omitted, secretKey must reference an existing secret.
 *
 * Both operations run in a single DB transaction — if either fails,
 * both are rolled back.
 */
export async function createConnectorWithSecret(
	input: CreateConnectorWithSecretInput,
): Promise<CreateConnectorWithSecretResult> {
	const preset = getConnectorPresetByKey(input.presetKey);
	if (!preset) {
		throw new PresetNotFoundError(input.presetKey);
	}

	const connectorName = input.name || preset.defaults.name;
	const connectorUrl = input.url || preset.defaults.url;
	if (!connectorName || !connectorUrl) {
		throw new ConnectorValidationError("Connector name and URL are required");
	}

	// Determine the base secret key
	const baseSecretKey =
		input.secretKey || preset.recommendedSecretKey || `${preset.key.toUpperCase()}_API_KEY`;

	// If reusing an existing secret (no value provided), just create the connector
	if (!input.secretValue) {
		if (!input.secretKey) {
			throw new ConnectorValidationError(
				"Either secretValue (to create) or secretKey (to reuse) is required",
			);
		}
		const connector = await createConnector({
			organizationId: input.organizationId,
			name: connectorName,
			transport: preset.defaults.transport,
			url: connectorUrl,
			auth: buildAuth(preset, input.secretKey),
			riskPolicy: input.riskPolicy ?? preset.defaults.riskPolicy,
			enabled: true,
			createdBy: input.createdBy,
		});
		return { connector, resolvedSecretKey: input.secretKey };
	}

	// Encrypt the secret value
	let encryptedValue: string;
	try {
		encryptedValue = encrypt(input.secretValue, getEncryptionKey());
	} catch {
		throw new ConnectorValidationError("Encryption not configured");
	}

	const description = `Auto-created for ${preset.name} connector`;

	// Build auth config template (secret key will be resolved by db layer)
	const authConfig =
		preset.defaults.auth.type === "custom_header"
			? {
					type: "custom_header" as const,
					headerName: (preset.defaults.auth as { headerName: string }).headerName,
				}
			: { type: "bearer" as const };

	// Delegate to db.ts for the transactional insert
	const { connectorRow, resolvedSecretKey } = await db.createWithSecret({
		organizationId: input.organizationId,
		createdBy: input.createdBy,
		encryptedValue,
		baseSecretKey,
		secretDescription: description,
		connector: {
			name: connectorName,
			transport: preset.defaults.transport,
			url: connectorUrl,
			riskPolicy: input.riskPolicy ?? preset.defaults.riskPolicy ?? null,
		},
		authConfig,
	});

	return {
		connector: toConnectorConfig(connectorRow),
		resolvedSecretKey,
	};
}

// ============================================
// Errors
// ============================================

export class PresetNotFoundError extends Error {
	constructor(key: string) {
		super(`Unknown connector preset: "${key}"`);
		this.name = "PresetNotFoundError";
	}
}

export class ConnectorValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConnectorValidationError";
	}
}

function classifyConnectorValidationError(message: string): ConnectorValidationDiagnosticClass {
	if (message.includes("timeout")) return "timeout";
	if (
		message.includes("ECONNREFUSED") ||
		message.includes("ENOTFOUND") ||
		message.includes("fetch failed")
	) {
		return "unreachable";
	}
	if (message.includes("401") || message.includes("403")) {
		return "auth";
	}
	if (message.includes("JSON") || message.includes("parse")) {
		return "protocol";
	}
	return "unknown";
}

// ============================================
// Internal helpers
// ============================================

function buildAuth(
	preset: { defaults: { auth: { type: string; headerName?: string } } },
	secretKey: string,
): ConnectorAuth {
	if (preset.defaults.auth.type === "custom_header") {
		return {
			type: "custom_header",
			secretKey,
			headerName: (preset.defaults.auth as { headerName: string }).headerName,
		};
	}
	return { type: "bearer", secretKey };
}
