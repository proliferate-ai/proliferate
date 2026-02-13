/**
 * Org-scoped connector service layer.
 *
 * Business logic for org-level MCP connector management.
 */

import type { ConnectorAuth, ConnectorConfig, ConnectorRiskPolicy } from "@proliferate/shared";

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
