/**
 * Org-scoped connector DB operations.
 *
 * All connector reads/writes go through this module.
 */

import { and, eq, getDb, isNull, orgConnectors, secrets } from "../db/client";

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

// ============================================
// Atomic secret + connector provisioning
// ============================================

export interface CreateConnectorWithSecretDbInput {
	organizationId: string;
	createdBy: string;
	/** Encrypted secret value. */
	encryptedValue: string;
	/** Base secret key (may be suffixed on collision). */
	baseSecretKey: string;
	/** Description for the auto-created secret. */
	secretDescription: string;
	/** Connector fields (auth is built from resolvedSecretKey + authConfig). */
	connector: {
		name: string;
		transport: string;
		url: string;
		riskPolicy: unknown;
	};
	/** Auth configuration template — secretKey will be filled with the resolved key. */
	authConfig: { type: "bearer" } | { type: "custom_header"; headerName: string };
}

export interface CreateConnectorWithSecretDbResult {
	connectorRow: OrgConnectorRow;
	resolvedSecretKey: string;
}

/**
 * Atomically create a secret and connector in a single transaction.
 * Resolves secret key collisions by auto-suffixing (_2, _3, ...).
 * Retries up to 3 times on unique constraint violations (concurrent races).
 */
export async function createWithSecret(
	input: CreateConnectorWithSecretDbInput,
): Promise<CreateConnectorWithSecretDbResult> {
	const db = getDb();
	const MAX_RETRIES = 3;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			return await db.transaction(async (tx) => {
				// Resolve a unique secret key inside the transaction.
				let resolvedSecretKey = input.baseSecretKey;
				const existing = await tx
					.select({ key: secrets.key })
					.from(secrets)
					.where(and(eq(secrets.organizationId, input.organizationId), isNull(secrets.repoId)));
				const existingKeys = new Set(existing.map((r) => r.key));

				if (existingKeys.has(input.baseSecretKey)) {
					let suffix = 2;
					while (existingKeys.has(`${input.baseSecretKey}_${suffix}`)) {
						suffix++;
						if (suffix > 100) {
							throw new Error(`Too many secret key collisions for "${input.baseSecretKey}"`);
						}
					}
					resolvedSecretKey = `${input.baseSecretKey}_${suffix}`;
				}

				// Create the secret
				await tx.insert(secrets).values({
					organizationId: input.organizationId,
					key: resolvedSecretKey,
					encryptedValue: input.encryptedValue,
					description: input.secretDescription,
					createdBy: input.createdBy,
				});

				// Build auth with the resolved secret key
				const auth =
					input.authConfig.type === "custom_header"
						? {
								type: "custom_header" as const,
								secretKey: resolvedSecretKey,
								headerName: input.authConfig.headerName,
							}
						: { type: "bearer" as const, secretKey: resolvedSecretKey };

				// Create the connector
				const [connectorRow] = await tx
					.insert(orgConnectors)
					.values({
						organizationId: input.organizationId,
						name: input.connector.name,
						transport: input.connector.transport,
						url: input.connector.url,
						auth,
						riskPolicy: input.connector.riskPolicy,
						enabled: true,
						createdBy: input.createdBy,
					})
					.returning();

				return { connectorRow, resolvedSecretKey };
			});
		} catch (err: unknown) {
			// Retry on unique constraint violation (Postgres error code 23505)
			const isUniqueViolation =
				err && typeof err === "object" && "code" in err && err.code === "23505";
			if (isUniqueViolation && attempt < MAX_RETRIES - 1) {
				continue;
			}
			throw err;
		}
	}

	throw new Error("Failed to create connector with secret after retries");
}

/**
 * List org-wide secret keys for an organization.
 * Used to populate the "use existing secret" dropdown in quick setup.
 */
export async function listOrgSecretKeys(organizationId: string): Promise<string[]> {
	const db = getDb();
	const rows = await db
		.select({ key: secrets.key })
		.from(secrets)
		.where(and(eq(secrets.organizationId, organizationId), isNull(secrets.repoId)));
	return rows.map((r) => r.key);
}
