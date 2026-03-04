/**
 * Integrations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import type {
	Integration,
	IntegrationWithCreator,
} from "@proliferate/shared/contracts/integrations";
import * as configurationsModule from "../configurations";
import { decrypt, encrypt, getEncryptionKey } from "../db/crypto";
import { toIsoString } from "../db/serialize";
import { getServicesLogger } from "../logger";
import * as orgsModule from "../orgs";
import * as sessions from "../sessions";
import * as integrationsDb from "./db";
import { attachCreators, groupByProvider, toIntegration, toIntegrationWithCreator } from "./mapper";
import {
	type JiraMetadata,
	type LinearMetadata,
	type SentryMetadata,
	fetchJiraMetadata,
	fetchLinearMetadata,
	fetchSentryMetadata,
} from "./providers";
import { getToken } from "./tokens";

const logger = getServicesLogger().child({ module: "integrations" });

export class OrganizationNotFoundError extends Error {
	constructor(message = "Organization not found") {
		super(message);
		this.name = "OrganizationNotFoundError";
	}
}

export class IntegrationAccessDeniedError extends Error {
	constructor(message = "Access denied") {
		super(message);
		this.name = "IntegrationAccessDeniedError";
	}
}

// ============================================
// Types
// ============================================

export interface ListIntegrationsResult {
	github: { connected: boolean };
	sentry: { connected: boolean };
	linear: { connected: boolean };
	jira: { connected: boolean };
	integrations: IntegrationWithCreator[];
	byProvider: {
		github: IntegrationWithCreator[];
		sentry: IntegrationWithCreator[];
		linear: IntegrationWithCreator[];
		jira: IntegrationWithCreator[];
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

export interface SaveOAuthAppIntegrationInput {
	organizationId: string;
	userId: string;
	provider: "sentry" | "linear" | "jira";
	connectionId: string;
	displayName: string;
	scopes?: string[];
	accessToken: string;
	refreshToken?: string | null;
	expiresInSeconds?: number;
	tokenType?: string | null;
	connectionMetadata?: Record<string, unknown> | null;
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
		jira: { connected: byProvider.jira.length > 0 },
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
 * Create or update provider-native OAuth integration with encrypted credentials.
 */
export async function saveOAuthAppIntegration(
	input: SaveOAuthAppIntegrationInput,
): Promise<IntegrationWithCreator> {
	const encryptionKey = getEncryptionKey();
	const encryptedAccessToken = encrypt(input.accessToken, encryptionKey);
	const encryptedRefreshToken = input.refreshToken
		? encrypt(input.refreshToken, encryptionKey)
		: undefined;
	const tokenExpiresAt =
		typeof input.expiresInSeconds === "number" && Number.isFinite(input.expiresInSeconds)
			? new Date(Date.now() + input.expiresInSeconds * 1000)
			: null;

	const row = await integrationsDb.upsertOAuthAppIntegration({
		organizationId: input.organizationId,
		integrationId: input.provider,
		connectionId: input.connectionId,
		displayName: input.displayName,
		createdBy: input.userId,
		scopes: input.scopes,
		encryptedAccessToken,
		encryptedRefreshToken,
		tokenExpiresAt,
		tokenType: input.tokenType ?? null,
		connectionMetadata: input.connectionMetadata ?? null,
	});

	const creator = row.createdBy ? await integrationsDb.getUser(row.createdBy) : null;
	return toIntegrationWithCreator(row, creator);
}

/**
 * Delete an integration and handle orphaned repos.
 */
export async function deleteIntegration(integrationId: string, orgId: string): Promise<void> {
	// Get the integration details
	const integration = await integrationsDb.findById(integrationId);

	if (!integration) {
		throw new IntegrationNotFoundError(integrationId);
	}

	if (integration.organizationId !== orgId) {
		throw new IntegrationAccessDeniedError();
	}

	const isGitHubApp = integration.provider === "github-app";
	const isGitHubRelated = isGitHubApp || integration.integrationId?.includes("github");

	// Delete from database
	await integrationsDb.deleteById(integrationId);

	// Handle orphaned repos for GitHub connections
	if (isGitHubRelated) {
		await handleOrphanedRepos(orgId);
	}
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
 * Get Jira connection status.
 */
export async function getJiraStatus(
	orgId: string | null,
	jiraIntegrationId: string,
): Promise<{ connected: boolean }> {
	if (!orgId) {
		return { connected: false };
	}

	const integration = await integrationsDb.findActiveByIntegrationId(orgId, jiraIntegrationId);
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

// ============================================
// Slack user/channel lookup utilities
// ============================================

const SLACK_API_BASE = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 10_000;

/**
 * Look up a Slack user ID by their email address using the Slack API.
 * Returns null if the user is not found or the API call fails.
 */
export async function findSlackUserIdByEmail(
	installationId: string,
	email: string,
): Promise<string | null> {
	const botToken = await integrationsDb.getSlackInstallationBotToken(installationId);
	if (!botToken) return null;

	const { decrypt, getEncryptionKey } = await import("@proliferate/shared/crypto");
	const token = decrypt(botToken, getEncryptionKey());

	try {
		const response = await fetch(
			`${SLACK_API_BASE}/users.lookupByEmail?email=${encodeURIComponent(email)}`,
			{
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
			},
		);
		const result = (await response.json()) as { ok: boolean; user?: { id: string } };
		return result.ok ? (result.user?.id ?? null) : null;
	} catch {
		return null;
	}
}

/**
 * List Slack workspace members for a dropdown selector.
 * Returns basic user info (id, name, real_name, email).
 */
export async function listSlackMembers(
	installationId: string,
): Promise<Array<{ id: string; name: string; realName: string | null; email: string | null }>> {
	const botToken = await integrationsDb.getSlackInstallationBotToken(installationId);
	if (!botToken) return [];

	const { decrypt, getEncryptionKey } = await import("@proliferate/shared/crypto");
	const token = decrypt(botToken, getEncryptionKey());

	const members: Array<{
		id: string;
		name: string;
		realName: string | null;
		email: string | null;
	}> = [];
	let cursor: string | undefined;

	// Paginate through all members (Slack API returns up to 1000 per page)
	do {
		const url = new URL(`${SLACK_API_BASE}/users.list`);
		if (cursor) url.searchParams.set("cursor", cursor);
		url.searchParams.set("limit", "200");

		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
		});
		const result = (await response.json()) as {
			ok: boolean;
			members?: Array<{
				id: string;
				name: string;
				real_name?: string;
				profile?: { email?: string };
				deleted?: boolean;
				is_bot?: boolean;
			}>;
			response_metadata?: { next_cursor?: string };
		};

		if (!result.ok || !result.members) break;

		for (const m of result.members) {
			// Skip bots, deleted users, and Slackbot
			if (m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
			members.push({
				id: m.id,
				name: m.name,
				realName: m.real_name ?? null,
				email: m.profile?.email ?? null,
			});
		}

		cursor = result.response_metadata?.next_cursor || undefined;
	} while (cursor);

	return members;
}

/**
 * List Slack channels for a channel picker.
 * Returns public channels the bot has access to.
 */
export async function listSlackChannels(
	installationId: string,
): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
	const botToken = await integrationsDb.getSlackInstallationBotToken(installationId);
	if (!botToken) return [];

	const { decrypt, getEncryptionKey } = await import("@proliferate/shared/crypto");
	const token = decrypt(botToken, getEncryptionKey());

	const channels: Array<{ id: string; name: string; isPrivate: boolean }> = [];
	let cursor: string | undefined;

	do {
		const url = new URL(`${SLACK_API_BASE}/conversations.list`);
		if (cursor) url.searchParams.set("cursor", cursor);
		url.searchParams.set("limit", "200");
		url.searchParams.set("types", "public_channel,private_channel");
		url.searchParams.set("exclude_archived", "true");

		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
		});
		const result = (await response.json()) as {
			ok: boolean;
			channels?: Array<{
				id: string;
				name: string;
				is_private?: boolean;
			}>;
			response_metadata?: { next_cursor?: string };
		};

		if (!result.ok || !result.channels) break;

		for (const c of result.channels) {
			channels.push({
				id: c.id,
				name: c.name,
				isPrivate: c.is_private ?? false,
			});
		}

		cursor = result.response_metadata?.next_cursor || undefined;
	} while (cursor);

	return channels;
}

// ============================================
// Error classes
// ============================================

export class IntegrationNotFoundError extends Error {
	constructor(id?: string) {
		super(id ? `Integration ${id} not found` : "Integration not found");
		this.name = "IntegrationNotFoundError";
	}
}

export class IntegrationInactiveError extends Error {
	constructor() {
		super("Integration is not active");
		this.name = "IntegrationInactiveError";
	}
}

export class IntegrationAdminRequiredError extends Error {
	constructor() {
		super("Admin or owner role required");
		this.name = "IntegrationAdminRequiredError";
	}
}

export class NoAccessTokenError extends Error {
	constructor() {
		super("No access token available");
		this.name = "NoAccessTokenError";
	}
}

export class SlackConfigValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SlackConfigValidationError";
	}
}

// ============================================
// Admin check
// ============================================

/**
 * Assert the user has admin or owner role in the organization.
 */
export async function assertIntegrationAdmin(userId: string, orgId: string): Promise<void> {
	const role = await orgsModule.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		throw new IntegrationAdminRequiredError();
	}
}

async function getRuntimeTokenForIntegration(
	integrationId: string,
	orgId: string,
): Promise<{
	token: string;
	integration: Pick<
		integrationsDb.IntegrationRow,
		"id" | "integrationId" | "provider" | "status" | "connectionMetadata"
	>;
}> {
	const integration = await integrationsDb.getIntegrationWithStatus(integrationId, orgId);
	if (!integration) {
		throw new IntegrationNotFoundError(integrationId);
	}
	if (integration.status !== "active") {
		throw new IntegrationInactiveError();
	}

	const token = await getToken({
		id: integration.id,
		provider: integration.provider,
		integrationId: integration.integrationId,
		connectionId: integration.connectionId,
		githubInstallationId: null,
		organizationId: orgId,
		status: integration.status,
		encryptedAccessToken: integration.encryptedAccessToken,
		encryptedRefreshToken: integration.encryptedRefreshToken,
		tokenExpiresAt: integration.tokenExpiresAt,
		tokenType: integration.tokenType,
		connectionMetadata: integration.connectionMetadata as Record<string, unknown> | null,
	});

	return {
		token,
		integration: {
			id: integration.id,
			integrationId: integration.integrationId,
			provider: integration.provider,
			status: integration.status,
			connectionMetadata: integration.connectionMetadata as Record<string, unknown> | null,
		},
	};
}

// ============================================
// Provider metadata
// ============================================

/**
 * Fetch Sentry metadata via resolved OAuth credentials.
 */
export async function getSentryMetadata(
	integrationId: string,
	orgId: string,
	projectSlug?: string,
): Promise<SentryMetadata> {
	const { token, integration } = await getRuntimeTokenForIntegration(integrationId, orgId);
	const metadata = (integration.connectionMetadata ?? {}) as { hostname?: string };
	const hostname = metadata.hostname || "sentry.io";
	return fetchSentryMetadata(token, hostname, projectSlug);
}

/**
 * Fetch Linear metadata via resolved OAuth credentials.
 */
export async function getLinearMetadata(
	integrationId: string,
	orgId: string,
	teamId?: string,
): Promise<LinearMetadata> {
	const { token } = await getRuntimeTokenForIntegration(integrationId, orgId);
	return fetchLinearMetadata(token, teamId);
}

/**
 * Fetch Jira metadata via resolved OAuth credentials.
 */
export async function getJiraMetadata(
	integrationId: string,
	orgId: string,
	siteId?: string,
	projectId?: string,
): Promise<JiraMetadata> {
	const { token } = await getRuntimeTokenForIntegration(integrationId, orgId);
	return fetchJiraMetadata(token, siteId, projectId);
}

// ============================================
// Disconnect
// ============================================

/**
 * Disconnect an integration.
 * Checks role-based access: admins can disconnect any, members only their own.
 */
export async function disconnectIntegration(
	integrationId: string,
	orgId: string,
	userId: string,
): Promise<void> {
	const integration = await getIntegration(integrationId, orgId);
	if (!integration) {
		throw new IntegrationNotFoundError(integrationId);
	}

	// Admin can disconnect anything; members can only disconnect their own
	const role = await orgsModule.getUserRole(userId, orgId);
	const isAdmin = role === "owner" || role === "admin";
	if (!isAdmin && integration.created_by !== userId) {
		throw new IntegrationAdminRequiredError();
	}

	// Delete from database and handle orphaned repos
	await deleteIntegration(integrationId, orgId);
}

/**
 * Disconnect Slack installation: revoke token with Slack API and mark revoked in DB.
 */
export async function disconnectSlack(orgId: string): Promise<void> {
	const installation = await getSlackInstallationForDisconnect(orgId);
	if (!installation) {
		throw new IntegrationNotFoundError();
	}

	// Decrypt and revoke token with Slack API
	try {
		const botToken = decrypt(installation.encryptedBotToken, getEncryptionKey());
		await fetch("https://slack.com/api/auth.revoke", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Bearer ${botToken}`,
			},
		});
	} catch (err) {
		logger.error({ err }, "Failed to revoke Slack token");
		// Continue with local revocation even if Slack API fails
	}

	await revokeSlackInstallation(installation.id);
}

// ============================================
// Slack config validation
// ============================================

export interface UpdateSlackConfigInput {
	installationId: string;
	orgId: string;
	strategy: "fixed" | "agent_decide";
	defaultConfigurationId?: string | null;
	allowedConfigurationIds?: string[] | null;
}

/**
 * Update Slack config with validation for strategy constraints.
 */
export async function updateSlackConfigWithValidation(
	input: UpdateSlackConfigInput,
): Promise<void> {
	const { installationId, orgId, strategy, defaultConfigurationId, allowedConfigurationIds } =
		input;

	if (defaultConfigurationId) {
		const belongs = await configurationsModule.configurationBelongsToOrg(
			defaultConfigurationId,
			orgId,
		);
		if (!belongs) {
			throw new SlackConfigValidationError("Default configuration not found in this org");
		}
	}

	if (strategy === "agent_decide") {
		if (!allowedConfigurationIds || allowedConfigurationIds.length === 0) {
			throw new SlackConfigValidationError(
				"Agent-decide strategy requires at least one allowed configuration",
			);
		}
	}

	if (strategy === "agent_decide" && allowedConfigurationIds?.length) {
		const candidates = await configurationsModule.getConfigurationCandidates(
			allowedConfigurationIds,
			orgId,
		);
		if (candidates.length !== allowedConfigurationIds.length) {
			throw new SlackConfigValidationError(
				"Some allowed configuration IDs are not found in this org",
			);
		}
		const missingDescription = candidates.filter(
			(c) => !c.routingDescription || c.routingDescription.trim().length === 0,
		);
		if (missingDescription.length > 0) {
			const names = missingDescription.map((c) => c.name).join(", ");
			throw new SlackConfigValidationError(
				`All allowed configurations must have routing descriptions. Missing: ${names}`,
			);
		}
	}

	const updated = await integrationsDb.updateSlackInstallationConfig(installationId, orgId, {
		defaultConfigSelectionStrategy: strategy,
		defaultConfigurationId,
		allowedConfigurationIds,
	});

	if (!updated) {
		throw new IntegrationNotFoundError();
	}
}

// ============================================
// DB passthrough wrappers
// (Thin service-layer wrappers so callers never import from db.ts directly)
// ============================================

/**
 * Find integration by ID (no org scoping).
 * Used by webhook/polling workers that operate outside an org context.
 */
export async function findById(id: string): Promise<integrationsDb.IntegrationRow | null> {
	return integrationsDb.findById(id);
}

/**
 * Find integration by ID scoped to an organization.
 */
export async function findByIdAndOrg(
	id: string,
	orgId: string,
): Promise<integrationsDb.IntegrationRow | null> {
	return integrationsDb.findByIdAndOrg(id, orgId);
}

/**
 * Find active GitHub App integration for an organization.
 */
export async function findActiveGitHubApp(
	orgId: string,
): Promise<integrationsDb.IntegrationRow | null> {
	return integrationsDb.findActiveGitHubApp(orgId);
}

/**
 * Find active integration by provider type (org-scoped).
 */
export async function findActiveByIntegrationId(
	orgId: string,
	integrationId: string,
): Promise<Pick<integrationsDb.IntegrationRow, "id" | "connectionId"> | null> {
	return integrationsDb.findActiveByIntegrationId(orgId, integrationId);
}

/**
 * Get repo connections with integration details for a repo.
 */
export async function getRepoConnectionsWithIntegrations(
	repoId: string,
): Promise<integrationsDb.RepoConnectionIntegrationRow[]> {
	return integrationsDb.getRepoConnectionsWithIntegrations(repoId);
}

/**
 * Mark a repo as orphaned (no remaining connections).
 */
export async function markRepoOrphaned(repoId: string): Promise<void> {
	return integrationsDb.markRepoOrphaned(repoId);
}

/**
 * Find a specific active integration by ID and organization (for available repos).
 */
export async function findActiveIntegrationForRepos(
	integrationId: string,
	orgId: string,
): Promise<integrationsDb.GitHubIntegrationRow | null> {
	return integrationsDb.findActiveIntegrationForRepos(integrationId, orgId);
}

/**
 * Find first active GitHub App integration for repos.
 */
export async function findFirstActiveGitHubAppForRepos(
	orgId: string,
): Promise<integrationsDb.GitHubIntegrationRow | null> {
	return integrationsDb.findFirstActiveGitHubAppForRepos(orgId);
}

/**
 * Find active integration by GitHub installation ID.
 * Used by GitHub App webhooks.
 */
export async function findActiveByGitHubInstallationId(
	installationId: string,
): Promise<integrationsDb.GitHubAppIntegrationRow | null> {
	return integrationsDb.findActiveByGitHubInstallationId(installationId);
}

/**
 * Update integration status by GitHub installation ID.
 * Used for installation lifecycle events.
 */
export async function updateStatusByGitHubInstallationId(
	installationId: string,
	status: string,
): Promise<void> {
	return integrationsDb.updateStatusByGitHubInstallationId(installationId, status);
}

/**
 * Find integration by connection ID and provider.
 * Used by Nango/webhook handlers.
 */
export async function findByConnectionIdAndProvider(
	connectionId: string,
	provider: string,
): Promise<Pick<integrationsDb.IntegrationRow, "id" | "organizationId" | "status"> | null> {
	return integrationsDb.findByConnectionIdAndProvider(connectionId, provider);
}

/**
 * Update integration status.
 */
export async function updateStatus(id: string, status: string): Promise<void> {
	return integrationsDb.updateStatus(id, status);
}

/**
 * Get encrypted bot token for a Slack installation.
 */
export async function getSlackInstallationBotToken(installationId: string): Promise<string | null> {
	return integrationsDb.getSlackInstallationBotToken(installationId);
}

/**
 * Get the configuration strategy fields for a Slack installation.
 */
export async function getSlackInstallationConfigStrategy(installationId: string): Promise<{
	defaultConfigurationId: string | null;
	defaultConfigSelectionStrategy: string | null;
} | null> {
	return integrationsDb.getSlackInstallationConfigStrategy(installationId);
}

/**
 * Get full selection config for a Slack installation.
 */
export async function getSlackInstallationSelectionConfig(installationId: string): Promise<{
	defaultConfigSelectionStrategy: string | null;
	defaultConfigurationId: string | null;
	fallbackConfigurationId: string | null;
	allowedConfigurationIds: string[] | null;
} | null> {
	return integrationsDb.getSlackInstallationSelectionConfig(installationId);
}

/**
 * Get active Slack installation for notifications.
 */
export async function getSlackInstallationForNotifications(
	orgId: string,
	installationId?: string | null,
): Promise<Pick<integrationsDb.SlackInstallationRow, "id" | "encryptedBotToken"> | null> {
	return integrationsDb.getSlackInstallationForNotifications(orgId, installationId);
}

/**
 * List all active Slack installations for an organization.
 */
export async function listActiveSlackInstallations(
	orgId: string,
): Promise<Pick<integrationsDb.SlackInstallationRow, "id" | "teamId" | "teamName">[]> {
	return integrationsDb.listActiveSlackInstallations(orgId);
}

/**
 * Get Slack installation config for an org.
 */
export async function getSlackInstallationConfigForOrg(orgId: string): Promise<{
	installationId: string;
	defaultConfigSelectionStrategy: string | null;
	defaultConfigurationId: string | null;
	allowedConfigurationIds: string[] | null;
} | null> {
	return integrationsDb.getSlackInstallationConfigForOrg(orgId);
}

/**
 * Find integration for binding validation.
 * Used by automation template creation.
 */
export async function findForBindingValidation(
	id: string,
	orgId: string,
): Promise<Pick<
	integrationsDb.IntegrationRow,
	"id" | "provider" | "integrationId" | "status"
> | null> {
	return integrationsDb.findForBindingValidation(id, orgId);
}

/**
 * List all integrations for an organization (no visibility filtering).
 * Used for privileged server-side operations like credential resolution.
 */
export async function listAllByOrganization(
	orgId: string,
): Promise<integrationsDb.IntegrationRow[]> {
	return integrationsDb.listAllByOrganization(orgId);
}

// ============================================
// Display names
// ============================================

/**
 * Get display name for a provider key.
 */
export function getDisplayNameForProvider(providerConfigKey: string): string {
	const staticNames: Record<string, string> = {
		github: "GitHub",
		sentry: "Sentry",
		linear: "Linear",
		jira: "Jira",
	};

	if (staticNames[providerConfigKey]) {
		return staticNames[providerConfigKey];
	}

	return providerConfigKey;
}
