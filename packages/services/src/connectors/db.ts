/**
 * Org-scoped connector DB operations.
 *
 * All connector reads/writes go through this module.
 */

import { and, eq, getDb, orgConnectors } from "../db/client";

// ============================================
// Types
// ============================================

export type OrgConnectorRow = typeof orgConnectors.$inferSelect;

export interface CreateOrgConnectorInput {
	organizationId: string;
	name: string;
	transport: string;
	url: string;
	auth: unknown;
	riskPolicy?: unknown;
	enabled: boolean;
	createdBy: string;
}

export interface UpdateOrgConnectorInput {
	name?: string;
	url?: string;
	auth?: unknown;
	riskPolicy?: unknown;
	enabled?: boolean;
}

// ============================================
// Queries
// ============================================

/**
 * List all connectors for an organization.
 */
export async function listByOrg(organizationId: string): Promise<OrgConnectorRow[]> {
	const db = getDb();
	return db.query.orgConnectors.findMany({
		where: eq(orgConnectors.organizationId, organizationId),
		orderBy: (t, { asc }) => [asc(t.createdAt)],
	});
}

/**
 * List enabled connectors for an organization.
 */
export async function listEnabledByOrg(organizationId: string): Promise<OrgConnectorRow[]> {
	const db = getDb();
	return db.query.orgConnectors.findMany({
		where: and(eq(orgConnectors.organizationId, organizationId), eq(orgConnectors.enabled, true)),
		orderBy: (t, { asc }) => [asc(t.createdAt)],
	});
}

/**
 * Find a connector by ID and organization.
 */
export async function findByIdAndOrg(
	id: string,
	organizationId: string,
): Promise<OrgConnectorRow | undefined> {
	const db = getDb();
	return db.query.orgConnectors.findFirst({
		where: and(eq(orgConnectors.id, id), eq(orgConnectors.organizationId, organizationId)),
	});
}

/**
 * Create a new org connector.
 */
export async function create(input: CreateOrgConnectorInput): Promise<OrgConnectorRow> {
	const db = getDb();
	const [row] = await db
		.insert(orgConnectors)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			transport: input.transport,
			url: input.url,
			auth: input.auth,
			riskPolicy: input.riskPolicy ?? null,
			enabled: input.enabled,
			createdBy: input.createdBy,
		})
		.returning();
	return row;
}

/**
 * Update an existing org connector.
 */
export async function update(
	id: string,
	organizationId: string,
	input: UpdateOrgConnectorInput,
): Promise<OrgConnectorRow | undefined> {
	const db = getDb();
	const [row] = await db
		.update(orgConnectors)
		.set({
			...(input.name !== undefined && { name: input.name }),
			...(input.url !== undefined && { url: input.url }),
			...(input.auth !== undefined && { auth: input.auth }),
			...(input.riskPolicy !== undefined && { riskPolicy: input.riskPolicy }),
			...(input.enabled !== undefined && { enabled: input.enabled }),
			updatedAt: new Date(),
		})
		.where(and(eq(orgConnectors.id, id), eq(orgConnectors.organizationId, organizationId)))
		.returning();
	return row;
}

/**
 * Delete an org connector.
 */
export async function deleteById(id: string, organizationId: string): Promise<boolean> {
	const db = getDb();
	const result = await db
		.delete(orgConnectors)
		.where(and(eq(orgConnectors.id, id), eq(orgConnectors.organizationId, organizationId)))
		.returning({ id: orgConnectors.id });
	return result.length > 0;
}
