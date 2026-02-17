/**
 * Integrations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import type { Integration, IntegrationWithCreator } from "@proliferate/shared";
import { toIsoString } from "../db/serialize";
import { getServicesLogger } from "../logger";
import * as sessions from "../sessions";
import * as integrationsDb from "./db";
import { attachCreators, groupByProvider, toIntegration, toIntegrationWithCreator } from "./mapper";

// ============================================
// Types
// ============================================

export interface ListIntegrationsResult {
	github: { connected: boolean };
	sentry: { connected: boolean };
	linear: { connected: boolean };
	integrations: IntegrationWithCreator[];
	byProvider: {
		github: IntegrationWithCreator[];
		sentry: IntegrationWithCreator[];
		linear: IntegrationWithCreator[];
	};
}

export interface GitHubStatusResult {
	connected: boolean;
	createdBy?: string;
	createdAt?: string;
	creator?: {
		id: string;
		name: string | null;
		email: string | null;
	} | null;
}

export interface SlackStatusResult {
	connected: boolean;
	teamId?: string;
	teamName?: string;
	scopes?: string[] | null;
	connectedAt?: string | null;
	updatedAt?: string | null;
	supportChannel?: {
		channelId: string;
		channelName: string | null;
		inviteUrl: string | null;
	};
}

export interface CreateIntegrationInput {
	organizationId: string;
	userId: string;
	connectionId: string;
	providerConfigKey: string;
	displayName: string;
}

// ============================================
// Service functions
// ============================================

/**
 * List all integrations for an organization, filtered by visibility.
 */
export async function listIntegrations(
	orgId: string,
	userId: string,
): Promise<ListIntegrationsResult> {
	// Fetch integrations (visibility filtered at DB level)
	const integrations = await integrationsDb.listByOrganization(orgId, userId);

	// Fetch creator info
	const creatorIds = [
		...new Set(integrations.map((i) => i.createdBy).filter((id): id is string => id !== null)),
	];
	const users = await integrationsDb.findUsersByIds(creatorIds);

	// Attach creators and group by provider
	const integrationsWithCreator = attachCreators(integrations, users);
	const byProvider = groupByProvider(integrationsWithCreator);

	return {
		github: { connected: byProvider.github.length > 0 },
		sentry: { connected: byProvider.sentry.length > 0 },
		linear: { connected: byProvider.linear.length > 0 },
		integrations: integrationsWithCreator,
		byProvider,
	};
}

/**
 * Get a single integration by ID.
 */
export async function getIntegration(
	id: string,
	orgId: string,
): Promise<IntegrationWithCreator | null> {
	const integration = await integrationsDb.findByIdAndOrg(id, orgId);
	if (!integration) return null;

	const creator = integration.createdBy
		? await integrationsDb.getUser(integration.createdBy)
		: null;
	return toIntegrationWithCreator(integration, creator);
}

/**
 * Update integration display name.
 */
export async function updateIntegration(
	id: string,
	orgId: string,
	displayName: string,
): Promise<Integration | null> {
	// Verify integration exists and belongs to org
	const existing = await integrationsDb.findByIdAndOrg(id, orgId);
	if (!existing) return null;

	const updated = await integrationsDb.updateDisplayName(id, displayName.trim() || null);
	return toIntegration(updated);
}

/**
 * Create or update integration from Nango callback.
 */
export async function saveIntegrationFromCallback(
	input: CreateIntegrationInput,
): Promise<{ success: boolean; existing: boolean }> {
	// Check if this connection_id already exists (re-authorization)
	const existingByConnectionId = await integrationsDb.findByConnectionId(input.connectionId);

	if (existingByConnectionId) {
		// Re-authorizing the same connection - update status
		await integrationsDb.updateStatus(existingByConnectionId.id, "active");
		return { success: true, existing: true };
	}

	// New connection - insert it
	await integrationsDb.create({
		id: randomUUID(),
		organizationId: input.organizationId,
		provider: "nango",
		integrationId: input.providerConfigKey,
		connectionId: input.connectionId,
		displayName: input.displayName,
		status: "active",
		visibility: "org",
		createdBy: input.userId,
	});

	return { success: true, existing: false };
}

/**
 * Delete an integration and handle orphaned repos.
 */
export async function deleteIntegration(
	integrationId: string,
	orgId: string,
): Promise<{ success: boolean; error?: string }> {
	// Get the integration details
	const integration = await integrationsDb.findById(integrationId);

	if (!integration) {
		return { success: false, error: "Connection not found" };
	}

	if (integration.organizationId !== orgId) {
		return { success: false, error: "Access denied" };
	}

	const isGitHubApp = integration.provider === "github-app";
	const isGitHubRelated = isGitHubApp || integration.integrationId?.includes("github");

	// Delete from database
	await integrationsDb.deleteById(integrationId);

	// Handle orphaned repos for GitHub connections
	if (isGitHubRelated) {
		await handleOrphanedRepos(orgId);
	}

	return { success: true };
}

/**
 * Mark repos as orphaned if they have no connections.
 */
async function handleOrphanedRepos(orgId: string): Promise<void> {
	const repos = await integrationsDb.getNonOrphanedRepos(orgId);

	for (const repo of repos) {
		const connectionCount = await integrationsDb.countRepoConnections(repo.id);
		if (connectionCount === 0) {
			await integrationsDb.markRepoOrphaned(repo.id);
		}
	}
}

// ============================================
// Provider status functions
// ============================================

/**
 * Get GitHub App connection status.
 */
export async function getGitHubStatus(orgId: string | null): Promise<GitHubStatusResult> {
	if (!orgId) {
		return { connected: false };
	}

	const integration = await integrationsDb.findActiveGitHubApp(orgId);

	if (!integration) {
		return { connected: false };
	}

	const creator = integration.createdBy
		? await integrationsDb.getUser(integration.createdBy)
		: null;

	return {
		connected: true,
		createdBy: integration.createdBy ?? undefined,
		createdAt: toIsoString(integration.createdAt) ?? undefined,
		creator: creator
			? {
					id: creator.id,
					name: creator.name,
					email: creator.email,
				}
			: null,
	};
}

/**
 * Get Sentry connection status.
 */
export async function getSentryStatus(
	orgId: string | null,
	sentryIntegrationId: string,
): Promise<{ connected: boolean }> {
	if (!orgId) {
		return { connected: false };
	}

	const integration = await integrationsDb.findActiveByIntegrationId(orgId, sentryIntegrationId);
	return { connected: !!integration };
}

/**
 * Get Linear connection status.
 */
export async function getLinearStatus(
	orgId: string | null,
	linearIntegrationId: string,
): Promise<{ connected: boolean }> {
	if (!orgId) {
		return { connected: false };
	}

	const integration = await integrationsDb.findActiveByIntegrationId(orgId, linearIntegrationId);
	return { connected: !!integration };
}

/**
 * Get Slack connection status.
 */
export async function getSlackStatus(orgId: string | null): Promise<SlackStatusResult> {
	if (!orgId) {
		return { connected: false };
	}

	const installation = await integrationsDb.getActiveSlackInstallation(orgId);

	if (!installation) {
		return { connected: false };
	}

	// Try to get support channel info
	let supportChannel:
		| { channelId: string; channelName: string | null; inviteUrl: string | null }
		| undefined;

	try {
		const withSupport = await integrationsDb.getSlackInstallationWithSupport(installation.id);

		if (withSupport?.supportChannelId) {
			supportChannel = {
				channelId: withSupport.supportChannelId,
				channelName: withSupport.supportChannelName ?? null,
				inviteUrl: withSupport.supportInviteUrl ?? null,
			};
		}
	} catch {
		// Support channel columns may not exist yet
	}

	return {
		connected: true,
		teamId: installation.teamId,
		teamName: installation.teamName ?? undefined,
		scopes: installation.scopes ?? undefined,
		connectedAt: toIsoString(installation.createdAt) ?? undefined,
		updatedAt: toIsoString(installation.updatedAt) ?? undefined,
		supportChannel,
	};
}

// ============================================
// Helper functions
// ============================================

/**
 * Get organization info for Nango session creation.
 */
export async function getOrganizationForSession(
	orgId: string,
): Promise<{ id: string; name: string } | null> {
	return integrationsDb.getOrganization(orgId);
}

/**
 * Check if an integration exists and is active.
 */
export async function isIntegrationActive(id: string, orgId: string): Promise<boolean> {
	const integration = await integrationsDb.findByIdAndOrg(id, orgId);
	return integration?.status === "active";
}

/**
 * Get integration with status for metadata operations.
 * Returns connection_id and status for Nango credential fetching.
 */
export async function getIntegrationWithStatus(
	id: string,
	orgId: string,
): Promise<{ id: string; connectionId: string | null; status: string | null } | null> {
	const integration = await integrationsDb.getIntegrationWithStatus(id, orgId);
	if (!integration) return null;

	return {
		id: integration.id,
		connectionId: integration.connectionId,
		status: integration.status,
	};
}

/**
 * Get user email by ID.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
	return integrationsDb.getUserEmail(userId);
}

/**
 * Update Slack support channel.
 */
export async function updateSlackSupportChannel(
	orgId: string,
	channelId: string,
	channelName: string,
	inviteId: string,
	inviteUrl: string,
): Promise<void> {
	await integrationsDb.updateSlackSupportChannel(
		orgId,
		channelId,
		channelName,
		inviteId,
		inviteUrl,
	);
}

/**
 * Disconnect Slack installation.
 * Returns the encrypted bot token for revocation.
 */
export async function getSlackInstallationForDisconnect(
	orgId: string,
): Promise<{ id: string; encryptedBotToken: string } | null> {
	const installation = await integrationsDb.getSlackInstallationForDisconnect(orgId);
	if (!installation) return null;

	return {
		id: installation.id,
		encryptedBotToken: installation.encryptedBotToken,
	};
}

/**
 * Revoke Slack installation.
 */
export async function revokeSlackInstallation(installationId: string): Promise<void> {
	await integrationsDb.revokeSlackInstallation(installationId);
}

/**
 * Get GitHub App status with creator info.
 */
export async function getGitHubStatusWithCreator(orgId: string): Promise<GitHubStatusResult> {
	const integration = await integrationsDb.findActiveGitHubAppWithCreator(orgId);

	if (!integration) {
		return { connected: false };
	}

	return {
		connected: true,
		createdBy: integration.createdBy ?? undefined,
		createdAt: toIsoString(integration.createdAt) ?? undefined,
		creator: integration.createdByUser
			? {
					id: integration.createdByUser.id,
					name: integration.createdByUser.name,
					email: integration.createdByUser.email,
				}
			: null,
	};
}

// ============================================
// GitHub App installation
// ============================================

/** Input for saving a GitHub App installation. */
export interface SaveGitHubAppInstallationInput {
	organizationId: string;
	installationId: string;
	displayName: string;
	createdBy: string;
}

/**
 * Save a GitHub App installation from OAuth callback.
 * Uses upsert to handle re-installations gracefully.
 */
export async function saveGitHubAppInstallation(
	input: SaveGitHubAppInstallationInput,
): Promise<{ success: boolean; integrationId?: string }> {
	const logger = getServicesLogger().child({ module: "integrations" });
	logger.info(
		{ orgId: input.organizationId, installationId: input.installationId },
		"Saving GitHub App installation",
	);
	const result = await integrationsDb.upsertGitHubAppInstallation(input);
	logger.debug({ resultId: result?.id ?? null }, "GitHub App installation saved");

	return { success: result !== null, integrationId: result?.id };
}

// ============================================
// Slack event handler functions
// ============================================

/** Slack installation info for event handling. */
export interface SlackInstallationForEvents {
	id: string;
	organizationId: string;
	encryptedBotToken: string;
}

/**
 * Find Slack installation by team ID.
 * Used by the Slack events handler to look up installation for incoming events.
 */
export async function findSlackInstallationByTeamId(
	teamId: string,
): Promise<SlackInstallationForEvents | null> {
	const installation = await integrationsDb.findSlackInstallationByTeamId(teamId);
	if (!installation) return null;

	return {
		id: installation.id,
		organizationId: installation.organizationId,
		encryptedBotToken: installation.encryptedBotToken,
	};
}

/**
 * Find existing Slack session by installation/channel/thread.
 * Used to check if a message is part of an existing conversation.
 */
export async function findSlackSessionByThread(
	installationId: string,
	channelId: string,
	threadTs: string,
): Promise<{ id: string } | null> {
	return sessions.findSessionBySlackThread(installationId, channelId, threadTs);
}

// ============================================
// Slack OAuth callback functions
// ============================================

/** Input for saving a Slack installation from OAuth callback. */
export interface SaveSlackInstallationInput {
	organizationId: string;
	userId: string;
	teamId: string;
	teamName: string;
	encryptedBotToken: string;
	botUserId: string;
	scopes: string[];
}

/** Result of saving a Slack installation. */
export interface SaveSlackInstallationResult {
	success: boolean;
	isUpdate: boolean;
}

/**
 * Save a Slack installation from OAuth callback.
 * Handles both new installations and re-authorizations.
 */
export async function saveSlackInstallation(
	input: SaveSlackInstallationInput,
): Promise<SaveSlackInstallationResult> {
	// Check if installation already exists for this org/team
	const existing = await integrationsDb.findSlackInstallationByOrgAndTeam(
		input.organizationId,
		input.teamId,
	);

	if (existing) {
		// Update existing installation
		await integrationsDb.updateSlackInstallation(existing.id, {
			teamName: input.teamName,
			encryptedBotToken: input.encryptedBotToken,
			botUserId: input.botUserId,
			scopes: input.scopes,
		});
		return { success: true, isUpdate: true };
	}

	// Create new installation
	await integrationsDb.createSlackInstallation({
		id: randomUUID(),
		organizationId: input.organizationId,
		teamId: input.teamId,
		teamName: input.teamName,
		encryptedBotToken: input.encryptedBotToken,
		botUserId: input.botUserId,
		scopes: input.scopes,
		installedBy: input.userId,
	});

	return { success: true, isUpdate: false };
}
