/**
 * Integrations DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	asc,
	desc,
	eq,
	getDb,
	inArray,
	integrations,
	isNotNull,
	isNull,
	organization,
	repoConnections,
	repos,
	type slackConversations,
	slackInstallations,
	sql,
	user,
} from "../db/client";
import { getServicesLogger } from "../logger";

// ============================================
// Type Exports (from Drizzle schema)
// ============================================

export type IntegrationRow = InferSelectModel<typeof integrations>;
export type SlackInstallationRow = InferSelectModel<typeof slackInstallations>;
export type SlackConversationRow = InferSelectModel<typeof slackConversations>;
export type RepoConnectionRow = InferSelectModel<typeof repoConnections>;
export type UserRow = Pick<InferSelectModel<typeof user>, "id" | "name" | "email">;
export type OrganizationRow = Pick<InferSelectModel<typeof organization>, "id" | "name">;

/** Integration with creator info. */
export interface IntegrationWithCreatorRow extends IntegrationRow {
	createdByUser: UserRow | null;
}

/** Integration info from repo connection. */
export interface RepoConnectionIntegrationRow {
	integration: {
		id: string;
		githubInstallationId: string | null;
		connectionId: string;
		createdBy: string | null;
		status: string | null;
	} | null;
}

/** Minimal GitHub integration row for listing available repos. */
export interface GitHubIntegrationRow {
	id: string;
	githubInstallationId: string | null;
	connectionId: string;
	provider: string;
}

/** Input for upserting a GitHub App installation. */
export interface UpsertGitHubAppInstallationInput {
	organizationId: string;
	installationId: string;
	displayName: string;
	createdBy: string;
}

/** Minimal integration row for GitHub App webhooks. */
export interface GitHubAppIntegrationRow {
	id: string;
	organizationId: string;
}

// ============================================
// Queries
// ============================================

/**
 * List all integrations for an organization.
 */
export async function listByOrganization(orgId: string): Promise<IntegrationRow[]> {
	const db = getDb();
	const results = await db.query.integrations.findMany({
		where: eq(integrations.organizationId, orgId),
		orderBy: [desc(integrations.createdAt)],
	});

	return results;
}

/**
 * Find users by IDs.
 */
export async function findUsersByIds(userIds: string[]): Promise<UserRow[]> {
	if (userIds.length === 0) return [];

	const db = getDb();
	const results = await db.query.user.findMany({
		where: inArray(user.id, userIds),
		columns: {
			id: true,
			name: true,
			email: true,
		},
	});

	return results;
}

/**
 * Find integration by ID.
 */
export async function findById(id: string): Promise<IntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: eq(integrations.id, id),
	});

	return result ?? null;
}

/**
 * Find integration by ID and organization.
 */
export async function findByIdAndOrg(id: string, orgId: string): Promise<IntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(eq(integrations.id, id), eq(integrations.organizationId, orgId)),
	});

	return result ?? null;
}

/**
 * Find integration by connection_id.
 */
export async function findByConnectionId(
	connectionId: string,
): Promise<Pick<IntegrationRow, "id"> | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: eq(integrations.connectionId, connectionId),
		columns: { id: true },
	});

	return result ?? null;
}

/**
 * Find integration by connection_id and provider (for Nango webhooks).
 */
export async function findByConnectionIdAndProvider(
	connectionId: string,
	provider: string,
): Promise<Pick<IntegrationRow, "id" | "organizationId" | "status"> | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(eq(integrations.connectionId, connectionId), eq(integrations.provider, provider)),
		columns: {
			id: true,
			organizationId: true,
			status: true,
		},
	});

	return result ?? null;
}

/**
 * Find active GitHub App integration for an organization.
 */
export async function findActiveGitHubApp(orgId: string): Promise<IntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.provider, "github-app"),
			eq(integrations.status, "active"),
			isNotNull(integrations.githubInstallationId),
		),
	});

	return result ?? null;
}

/**
 * Find active integration by provider type.
 */
export async function findActiveByIntegrationId(
	orgId: string,
	integrationId: string,
): Promise<Pick<IntegrationRow, "id" | "connectionId"> | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.integrationId, integrationId),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			connectionId: true,
		},
	});

	return result ?? null;
}

/**
 * Create a new integration.
 */
export async function create(input: {
	id: string;
	organizationId: string;
	provider: string;
	integrationId: string;
	connectionId: string;
	displayName: string;
	status: string;
	visibility: string;
	createdBy: string;
}): Promise<IntegrationRow> {
	const db = getDb();
	const [result] = await db
		.insert(integrations)
		.values({
			id: input.id,
			organizationId: input.organizationId,
			provider: input.provider,
			integrationId: input.integrationId,
			connectionId: input.connectionId,
			displayName: input.displayName,
			status: input.status,
			visibility: input.visibility,
			createdBy: input.createdBy,
		})
		.returning();

	return result;
}

/**
 * Update integration status.
 */
export async function updateStatus(id: string, status: string): Promise<void> {
	const db = getDb();
	await db
		.update(integrations)
		.set({
			status,
			updatedAt: new Date(),
		})
		.where(eq(integrations.id, id));
}

/**
 * Update integration display name.
 */
export async function updateDisplayName(
	id: string,
	displayName: string | null,
): Promise<IntegrationRow> {
	const db = getDb();
	const [result] = await db
		.update(integrations)
		.set({ displayName })
		.where(eq(integrations.id, id))
		.returning();

	return result;
}

/**
 * Delete an integration by ID.
 */
export async function deleteById(id: string): Promise<void> {
	const db = getDb();
	await db.delete(integrations).where(eq(integrations.id, id));
}

/**
 * Get organization by ID.
 */
export async function getOrganization(orgId: string): Promise<OrganizationRow | null> {
	const db = getDb();
	const result = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
		columns: {
			id: true,
			name: true,
		},
	});

	return result ?? null;
}

/**
 * Get user by ID.
 */
export async function getUser(userId: string): Promise<UserRow | null> {
	const db = getDb();
	const result = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: {
			id: true,
			name: true,
			email: true,
		},
	});

	return result ?? null;
}

// ============================================
// Slack-specific queries
// ============================================

/**
 * Get active Slack installation for an organization.
 */
export async function getActiveSlackInstallation(
	orgId: string,
): Promise<SlackInstallationRow | null> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: and(
			eq(slackInstallations.organizationId, orgId),
			eq(slackInstallations.status, "active"),
		),
	});

	return result ?? null;
}

/**
 * Get Slack installation with support channel info.
 */
export async function getSlackInstallationWithSupport(
	installationId: string,
): Promise<SlackInstallationRow | null> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: eq(slackInstallations.id, installationId),
	});

	return result ?? null;
}

/**
 * Update Slack installation support channel.
 */
export async function updateSlackSupportChannel(
	orgId: string,
	channelId: string,
	_channelName: string,
	_inviteId: string,
	inviteUrl: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(slackInstallations)
		.set({
			supportChannelId: channelId,
			supportInviteUrl: inviteUrl,
			updatedAt: new Date(),
		})
		.where(
			and(eq(slackInstallations.organizationId, orgId), eq(slackInstallations.status, "active")),
		);
}

/**
 * Get Slack installation for disconnect.
 */
export async function getSlackInstallationForDisconnect(
	orgId: string,
): Promise<Pick<SlackInstallationRow, "id" | "encryptedBotToken"> | null> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: and(
			eq(slackInstallations.organizationId, orgId),
			eq(slackInstallations.status, "active"),
		),
		columns: {
			id: true,
			encryptedBotToken: true,
		},
	});

	return result ?? null;
}

/**
 * Mark Slack installation as revoked.
 */
export async function revokeSlackInstallation(installationId: string): Promise<void> {
	const db = getDb();
	await db
		.update(slackInstallations)
		.set({
			status: "revoked",
			updatedAt: new Date(),
		})
		.where(eq(slackInstallations.id, installationId));
}

/**
 * Get user email by ID.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
	const db = getDb();
	const result = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { email: true },
	});

	return result?.email ?? null;
}

/**
 * Find active GitHub App integration with creator info.
 */
export async function findActiveGitHubAppWithCreator(
	orgId: string,
): Promise<IntegrationWithCreatorRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.provider, "github-app"),
			eq(integrations.status, "active"),
			isNotNull(integrations.githubInstallationId),
		),
		with: {
			user: {
				columns: {
					id: true,
					name: true,
					email: true,
				},
			},
		},
	});

	if (!result) return null;
	const { user: createdByUser, ...rest } = result;
	return { ...rest, createdByUser: createdByUser ?? null };
}

/**
 * Get integration with status for metadata endpoints.
 */
export async function getIntegrationWithStatus(
	id: string,
	orgId: string,
): Promise<Pick<IntegrationRow, "id" | "connectionId" | "status"> | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(eq(integrations.id, id), eq(integrations.organizationId, orgId)),
		columns: {
			id: true,
			connectionId: true,
			status: true,
		},
	});

	return result ?? null;
}

// ============================================
// Repo connection queries (for orphan handling)
// ============================================

/**
 * Get non-orphaned repos for an organization.
 */
export async function getNonOrphanedRepos(orgId: string): Promise<{ id: string }[]> {
	const db = getDb();
	const results = await db.query.repos.findMany({
		where: and(eq(repos.organizationId, orgId), eq(repos.isOrphaned, false)),
		columns: { id: true },
	});

	return results;
}

/**
 * Count repo connections.
 */
export async function countRepoConnections(repoId: string): Promise<number> {
	const db = getDb();
	const result = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(repoConnections)
		.where(eq(repoConnections.repoId, repoId));

	return result[0]?.count ?? 0;
}

/**
 * Mark repo as orphaned.
 */
export async function markRepoOrphaned(repoId: string): Promise<void> {
	const db = getDb();
	await db.update(repos).set({ isOrphaned: true }).where(eq(repos.id, repoId));
}

// ============================================
// Repo connection queries (for session creation)
// ============================================

/**
 * Get repo connections with integration details for a repo.
 */
export async function getRepoConnectionsWithIntegrations(
	repoId: string,
): Promise<RepoConnectionIntegrationRow[]> {
	const db = getDb();
	const results = await db.query.repoConnections.findMany({
		where: eq(repoConnections.repoId, repoId),
		with: {
			integration: {
				columns: {
					id: true,
					githubInstallationId: true,
					connectionId: true,
					createdBy: true,
					status: true,
				},
			},
		},
	});

	return results;
}

/**
 * Find active Nango GitHub integration for an organization.
 */
export async function findActiveNangoGitHub(
	orgId: string,
	integrationId: string,
): Promise<Pick<IntegrationRow, "id" | "githubInstallationId" | "connectionId"> | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.integrationId, integrationId),
			eq(integrations.status, "active"),
			isNull(integrations.githubInstallationId),
			isNotNull(integrations.connectionId),
		),
		columns: {
			id: true,
			githubInstallationId: true,
			connectionId: true,
		},
		orderBy: [asc(integrations.createdAt)],
	});

	return result ?? null;
}

// ============================================
// GitHub integration queries (for available repos)
// ============================================

/**
 * Find a specific active integration by ID and organization.
 * Used when integrationId is explicitly provided.
 */
export async function findActiveIntegrationForRepos(
	integrationId: string,
	orgId: string,
): Promise<GitHubIntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.id, integrationId),
			eq(integrations.organizationId, orgId),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			githubInstallationId: true,
			connectionId: true,
			provider: true,
		},
	});

	return result ?? null;
}

/**
 * Find first active GitHub App integration for an organization.
 * Returns integration with github_installation_id set.
 */
export async function findFirstActiveGitHubAppForRepos(
	orgId: string,
): Promise<GitHubIntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.provider, "github-app"),
			eq(integrations.status, "active"),
			isNotNull(integrations.githubInstallationId),
		),
		columns: {
			id: true,
			githubInstallationId: true,
			connectionId: true,
			provider: true,
		},
		orderBy: [asc(integrations.createdAt)],
	});

	return result ?? null;
}

/**
 * Find first active Nango GitHub integration for an organization.
 * Returns integration with connection_id set (no github_installation_id).
 */
export async function findFirstActiveNangoGitHubForRepos(
	orgId: string,
	nangoIntegrationId: string,
): Promise<GitHubIntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.integrationId, nangoIntegrationId),
			eq(integrations.status, "active"),
			isNull(integrations.githubInstallationId),
			isNotNull(integrations.connectionId),
		),
		columns: {
			id: true,
			githubInstallationId: true,
			connectionId: true,
			provider: true,
		},
		orderBy: [asc(integrations.createdAt)],
	});

	return result ?? null;
}

// ============================================
// GitHub App installation upsert
// ============================================

/**
 * Upsert a GitHub App installation.
 * Uses connection_id as the conflict key to handle re-installations.
 */
export async function upsertGitHubAppInstallation(
	input: UpsertGitHubAppInstallationInput,
): Promise<IntegrationRow | null> {
	const logger = getServicesLogger().child({
		module: "integrations-db",
		orgId: input.organizationId,
	});
	const db = getDb();
	const connectionId = `github-app-${input.installationId}`;

	logger.debug(
		{
			installationId: input.installationId,
			displayName: input.displayName,
			connectionId,
		},
		"Upserting GitHub App installation",
	);

	// Check if row already exists for this org
	const existing = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.connectionId, connectionId),
			eq(integrations.organizationId, input.organizationId),
		),
	});
	logger.debug({ existingId: existing?.id ?? null }, "Checked for existing installation");

	try {
		const [result] = await db
			.insert(integrations)
			.values({
				organizationId: input.organizationId,
				provider: "github-app",
				integrationId: "github-app",
				connectionId: connectionId,
				githubInstallationId: input.installationId,
				displayName: input.displayName,
				status: "active",
				createdBy: input.createdBy,
			})
			.onConflictDoUpdate({
				target: [integrations.connectionId, integrations.organizationId],
				set: {
					displayName: input.displayName,
					status: "active",
					updatedAt: new Date(),
				},
			})
			.returning();

		logger.debug({ resultId: result?.id ?? null }, "Upsert complete");

		// Verify it was actually written
		const verify = await db.query.integrations.findFirst({
			where: and(
				eq(integrations.connectionId, connectionId),
				eq(integrations.organizationId, input.organizationId),
			),
		});
		logger.debug({ verified: !!verify }, "Verification read");

		return result ?? null;
	} catch (error) {
		logger.error({ err: error }, "Failed to upsert GitHub App installation");
		throw error;
	}
}

// ============================================
// GitHub App webhook queries
// ============================================

/**
 * Find active integration by GitHub installation ID.
 * Used by GitHub App webhooks to resolve installation to integration.
 */
export async function findActiveByGitHubInstallationId(
	installationId: string,
): Promise<GitHubAppIntegrationRow | null> {
	const db = getDb();
	const result = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.githubInstallationId, installationId),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			organizationId: true,
		},
	});

	return result ?? null;
}

/**
 * Update integration status by GitHub installation ID.
 * Used for installation lifecycle events (deleted, suspended, unsuspended).
 */
export async function updateStatusByGitHubInstallationId(
	installationId: string,
	status: string,
): Promise<void> {
	const db = getDb();
	await db
		.update(integrations)
		.set({
			status,
			updatedAt: new Date(),
		})
		.where(eq(integrations.githubInstallationId, installationId));
}

// ============================================
// Slack event handler queries
// ============================================

/**
 * Find active Slack installation by team ID.
 * Used by the Slack events handler to look up installation for incoming events.
 */
export async function findSlackInstallationByTeamId(
	teamId: string,
): Promise<Pick<SlackInstallationRow, "id" | "organizationId" | "encryptedBotToken"> | null> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: and(eq(slackInstallations.teamId, teamId), eq(slackInstallations.status, "active")),
		columns: {
			id: true,
			organizationId: true,
			encryptedBotToken: true,
		},
	});

	return result ?? null;
}

// ============================================
// Slack installation mutations (OAuth callback)
// ============================================

/**
 * Find Slack installation by organization and team ID.
 * Used during OAuth callback to check for existing installation.
 */
export async function findSlackInstallationByOrgAndTeam(
	orgId: string,
	teamId: string,
): Promise<{ id: string } | null> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: and(eq(slackInstallations.organizationId, orgId), eq(slackInstallations.teamId, teamId)),
		columns: { id: true },
	});

	return result ?? null;
}

/**
 * Update an existing Slack installation.
 * Used during OAuth callback when re-authorizing.
 */
export async function updateSlackInstallation(
	id: string,
	input: {
		teamName: string;
		encryptedBotToken: string;
		botUserId: string;
		scopes: string[];
	},
): Promise<void> {
	const db = getDb();
	await db
		.update(slackInstallations)
		.set({
			teamName: input.teamName,
			encryptedBotToken: input.encryptedBotToken,
			botUserId: input.botUserId,
			scopes: input.scopes,
			status: "active",
			updatedAt: new Date(),
		})
		.where(eq(slackInstallations.id, id));
}

/**
 * Create a new Slack installation.
 * Used during OAuth callback for first-time installation.
 */
export async function createSlackInstallation(input: {
	id: string;
	organizationId: string;
	teamId: string;
	teamName: string;
	encryptedBotToken: string;
	botUserId: string;
	scopes: string[];
	installedBy: string;
}): Promise<void> {
	const db = getDb();
	await db.insert(slackInstallations).values({
		id: input.id,
		organizationId: input.organizationId,
		teamId: input.teamId,
		teamName: input.teamName,
		encryptedBotToken: input.encryptedBotToken,
		botUserId: input.botUserId,
		scopes: input.scopes,
		installedBy: input.installedBy,
		status: "active",
	});
}

/**
 * Get encrypted bot token for a Slack installation.
 * Used by SlackClient.wake() to fetch token before posting messages.
 */
export async function getSlackInstallationBotToken(installationId: string): Promise<string | null> {
	const db = getDb();
	const result = await db.query.slackInstallations.findFirst({
		where: eq(slackInstallations.id, installationId),
		columns: {
			encryptedBotToken: true,
		},
	});

	return result?.encryptedBotToken ?? null;
}
