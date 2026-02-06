/**
 * CLI service.
 *
 * Business logic that orchestrates DB operations.
 */

import crypto from "node:crypto";
import { randomBytes } from "node:crypto";
import type {
	CliPrebuildRow,
	CliSessionFullRow,
	CliSessionRow,
	CreateCliSessionInput,
	DeviceCodeRow,
	GitHubIntegrationForTokenRow,
	SshKeyRow,
} from "../types/cli";
import * as cliDb from "./db";

// ============================================
// Helper functions
// ============================================

/**
 * Generate a user-friendly code for device authentication.
 */
export function generateUserCode(): string {
	const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
	const numbers = "0123456789";

	let code = "";
	for (let i = 0; i < 4; i++) {
		code += letters[Math.floor(Math.random() * letters.length)];
	}
	code += "-";
	for (let i = 0; i < 4; i++) {
		code += numbers[Math.floor(Math.random() * numbers.length)];
	}
	return code;
}

/**
 * Generate a device code for CLI authentication.
 */
export function generateDeviceCode(): string {
	return randomBytes(32).toString("hex");
}

/**
 * Get SSH key fingerprint from public key.
 */
export function getSSHKeyFingerprint(publicKey: string): string {
	const parts = publicKey.trim().split(/\s+/);
	if (parts.length < 2) {
		throw new Error("Invalid SSH public key format");
	}

	const keyData = parts[1];
	const decoded = Buffer.from(keyData, "base64");

	const hash = crypto.createHash("sha256").update(decoded).digest("base64");
	return `SHA256:${hash.replace(/=+$/, "")}`;
}

/**
 * Normalize user code input.
 */
export function normalizeUserCode(userCode: string): string {
	const normalized = userCode.toUpperCase().replace(/\s/g, "");
	return normalized.includes("-") ? normalized : `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

// ============================================
// Device Code functions
// ============================================

/**
 * Create a device code for CLI authentication.
 */
export async function createDeviceCode(devUserId?: string): Promise<{
	userCode: string;
	deviceCode: string;
	expiresIn: number;
	interval: number;
}> {
	const userCode = generateUserCode();
	const deviceCode = generateDeviceCode();
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
	const initialStatus = devUserId ? "authorized" : "pending";

	await cliDb.createDeviceCode({
		userCode,
		deviceCode,
		expiresAt: expiresAt.toISOString(),
		status: initialStatus,
		userId: devUserId || null,
	});

	return {
		userCode,
		deviceCode,
		expiresIn: 900,
		interval: 5,
	};
}

/**
 * Authorize a device code.
 */
export async function authorizeDeviceCode(
	userCode: string,
	userId: string,
	orgId: string | undefined,
): Promise<{ success: boolean; error?: string }> {
	const normalizedCode = normalizeUserCode(userCode);

	const codeData = await cliDb.findDeviceCodeByUserCode(normalizedCode);
	if (!codeData) {
		return { success: false, error: "Invalid or expired code. Please try again." };
	}

	if (new Date(codeData.expires_at) < new Date()) {
		await cliDb.deleteDeviceCode(codeData.id);
		return {
			success: false,
			error: "This code has expired. Please request a new one from the CLI.",
		};
	}

	await cliDb.authorizeDeviceCode(codeData.id, userId, orgId);
	return { success: true };
}

/**
 * Poll for device code authorization.
 */
export async function pollDeviceCode(deviceCode: string): Promise<{
	status: "pending" | "authorized" | "expired" | "invalid";
	codeData?: DeviceCodeRow;
}> {
	const codeData = await cliDb.findDeviceCodeByDeviceCode(deviceCode);

	if (!codeData) {
		return { status: "invalid" };
	}

	if (new Date(codeData.expires_at) < new Date()) {
		await cliDb.deleteDeviceCode(codeData.id);
		return { status: "expired" };
	}

	if (codeData.status === "pending") {
		return { status: "pending" };
	}

	if (codeData.status === "authorized" && codeData.user_id) {
		return { status: "authorized", codeData };
	}

	return { status: "invalid" };
}

/**
 * Complete device authorization.
 */
export async function completeDeviceAuthorization(
	codeData: DeviceCodeRow,
	integrationIds: string[],
): Promise<{
	user: { id: string | null; email: string | null; name: string | null };
	org: { id: string | null; name: string | null };
	hasGitHubConnection: boolean;
}> {
	const user = codeData.user_id ? await cliDb.getUser(codeData.user_id) : null;
	const org = codeData.org_id ? await cliDb.getOrganization(codeData.org_id) : null;

	let hasGitHubConnection = false;
	if (codeData.org_id && integrationIds.length > 0) {
		hasGitHubConnection = await cliDb.hasGitHubIntegration(codeData.org_id, integrationIds);
	}

	await cliDb.deleteDeviceCode(codeData.id);

	return {
		user: {
			id: user?.id ?? null,
			email: user?.email ?? null,
			name: user?.name ?? null,
		},
		org: {
			id: org?.id ?? null,
			name: org?.name ?? null,
		},
		hasGitHubConnection,
	};
}

// ============================================
// SSH Key functions
// ============================================

/**
 * List SSH keys for a user.
 */
export async function listSshKeys(userId: string): Promise<SshKeyRow[]> {
	return cliDb.listSshKeys(userId);
}

/**
 * Get SSH public keys for a user.
 */
export async function getSshPublicKeys(userId: string): Promise<string[]> {
	const keys = await cliDb.getSshPublicKeys(userId);
	return keys.map((k) => k.public_key);
}

/**
 * Create an SSH key.
 */
export async function createSshKey(
	userId: string,
	publicKey: string,
	name?: string,
): Promise<SshKeyRow> {
	const fingerprint = getSSHKeyFingerprint(publicKey);

	return cliDb.createSshKey({
		userId,
		publicKey,
		fingerprint,
		name: name || null,
	});
}

/**
 * Delete all SSH keys for a user.
 */
export async function deleteAllSshKeys(userId: string): Promise<void> {
	return cliDb.deleteAllSshKeys(userId);
}

/**
 * Delete a specific SSH key.
 */
export async function deleteSshKey(id: string, userId: string): Promise<boolean> {
	const result = await cliDb.deleteSshKey(id, userId);
	return result !== null;
}

// ============================================
// Repo functions
// ============================================

/**
 * Get local repo by path hash.
 */
export async function getLocalRepo(
	orgId: string,
	localPathHash: string,
): Promise<{
	repo: { id: string; localPathHash: string | null; displayName: string } | null;
	connection: {
		id: string;
		integrationId: string | null;
		integration: {
			id: string;
			integration_id: string;
			display_name: string | null;
			status: string;
		} | null;
	} | null;
}> {
	const repo = await cliDb.findLocalRepo(orgId, localPathHash);
	if (!repo) {
		return { repo: null, connection: null };
	}

	const connection = await cliDb.getRepoConnection(repo.id);

	return {
		repo: {
			id: repo.id,
			localPathHash: repo.local_path_hash,
			displayName: repo.github_repo_name,
		},
		connection: connection
			? {
					id: connection.id,
					integrationId: connection.integration_id,
					integration: connection.integrations,
				}
			: null,
	};
}

/**
 * Create or update a local repo.
 */
export async function upsertLocalRepo(
	orgId: string,
	userId: string,
	localPathHash: string,
	displayName?: string,
	integrationId?: string,
): Promise<{ repoId: string; integrationId: string | null }> {
	// Check if repo exists
	const existingRepo = await cliDb.findLocalRepo(orgId, localPathHash);

	let repoId: string;

	if (existingRepo) {
		repoId = existingRepo.id;
		if (displayName) {
			await cliDb.updateRepoDisplayName(repoId, displayName);
		}
	} else {
		const newRepo = await cliDb.createLocalRepo({
			organizationId: orgId,
			addedBy: userId,
			localPathHash,
			displayName: displayName || "Local Directory",
		});
		repoId = newRepo.id;
	}

	// Handle integration linking
	if (integrationId) {
		await cliDb.deleteRepoConnections(repoId);

		if (integrationId !== "local-git") {
			await cliDb.createRepoConnection(repoId, integrationId);
		}
	}

	return { repoId, integrationId: integrationId || null };
}

/**
 * Delete all local repos for an organization.
 */
export async function deleteAllLocalRepos(orgId: string): Promise<number> {
	const result = await cliDb.deleteAllLocalRepos(orgId);
	return result.count;
}

// ============================================
// Session functions
// ============================================

/**
 * List CLI sessions.
 */
export async function listCliSessions(
	orgId: string,
	localPathHash?: string,
): Promise<CliSessionRow[]> {
	return cliDb.listCliSessions(orgId, localPathHash);
}

/**
 * Find a resumable session.
 */
export async function findResumableSession(
	orgId: string,
	localPathHash: string,
): Promise<{ sessionId: string; status: string } | null> {
	const session = await cliDb.findResumableSession(orgId, localPathHash);
	if (!session || session.status !== "running") {
		return null;
	}
	return { sessionId: session.id, status: session.status };
}

/**
 * Create a CLI session record.
 */
export async function createCliSession(input: CreateCliSessionInput): Promise<void> {
	return cliDb.createCliSession(input);
}

/**
 * Delete a session by ID.
 */
export async function deleteSession(sessionId: string): Promise<void> {
	return cliDb.deleteSession(sessionId);
}

/**
 * Update session with sandbox info after creation.
 */
export async function updateSessionWithSandbox(
	sessionId: string,
	sandboxId: string | null,
	status: string,
	previewTunnelUrl: string | null,
): Promise<void> {
	return cliDb.updateSessionWithSandbox(sessionId, sandboxId, status, previewTunnelUrl);
}

/**
 * Get CLI sessions for termination (running or starting).
 */
export async function getCliSessionsForTermination(orgId: string): Promise<CliSessionFullRow[]> {
	return cliDb.getCliSessionsForTermination(orgId);
}

/**
 * Stop all CLI sessions for an organization.
 */
export async function stopAllCliSessions(orgId: string): Promise<void> {
	return cliDb.stopAllCliSessions(orgId);
}

/**
 * Get a session by ID and organization (full details).
 */
export async function getSessionByIdAndOrg(
	sessionId: string,
	orgId: string,
): Promise<Record<string, unknown> | null> {
	return cliDb.getSessionByIdAndOrg(sessionId, orgId);
}

/**
 * Get session for termination.
 */
export async function getSessionForTermination(
	sessionId: string,
	orgId: string,
): Promise<CliSessionFullRow | null> {
	return cliDb.getSessionForTermination(sessionId, orgId);
}

/**
 * Stop a session by ID.
 */
export async function stopSession(sessionId: string): Promise<void> {
	return cliDb.stopSession(sessionId);
}

// ============================================
// Prebuild functions
// ============================================

/**
 * Get CLI prebuild.
 */
export async function getCliPrebuild(
	userId: string,
	localPathHash: string,
): Promise<CliPrebuildRow | null> {
	return cliDb.getCliPrebuild(userId, localPathHash);
}

/**
 * Delete CLI prebuild.
 */
export async function deleteCliPrebuild(userId: string, localPathHash: string): Promise<void> {
	return cliDb.deleteCliPrebuild(userId, localPathHash);
}

/**
 * Upsert CLI prebuild (create snapshot cache).
 */
export async function upsertCliPrebuild(
	userId: string,
	localPathHash: string,
	snapshotId: string,
	sandboxProvider: string,
): Promise<CliPrebuildRow> {
	return cliDb.upsertCliPrebuild({
		userId,
		localPathHash,
		snapshotId,
		sandboxProvider,
	});
}

// ============================================
// User/Org functions
// ============================================

/**
 * Get user's first organization ID.
 */
export async function getUserFirstOrganization(userId: string): Promise<string | null> {
	const member = await cliDb.getUserFirstOrganization(userId);
	return member?.organizationId ?? null;
}

// ============================================
// GitHub functions
// ============================================

/**
 * Get GitHub connection status.
 */
export async function getGitHubStatus(
	orgId: string,
	integrationIds: string[],
): Promise<{ connected: boolean; username: string | null }> {
	const integration = await cliDb.getActiveGitHubIntegration(orgId, integrationIds);

	if (integration) {
		const displayName = integration.display_name || "";
		const username = displayName.split(" ")[0] || null;
		return { connected: true, username };
	}

	return { connected: false, username: null };
}

/**
 * Get organization name.
 */
export async function getOrganizationName(orgId: string): Promise<string | null> {
	const org = await cliDb.getOrganization(orgId);
	return org?.name ?? null;
}

/**
 * Get GitHub integration for token retrieval.
 */
export async function getGitHubIntegrationForToken(
	orgId: string,
	integrationId: string,
): Promise<GitHubIntegrationForTokenRow | null> {
	return cliDb.getGitHubIntegrationForToken(orgId, integrationId);
}

/**
 * Check CLI GitHub selection.
 */
export async function checkCliGitHubSelection(
	userId: string,
	orgId: string,
): Promise<{ connectionId: string; valid: boolean } | null> {
	const selection = await cliDb.getCliGitHubSelection(userId, orgId);
	if (!selection) return null;

	const isValid = new Date(selection.expires_at) > new Date();
	return { connectionId: selection.connection_id, valid: isValid };
}

/**
 * Consume CLI GitHub selection (delete after use).
 */
export async function consumeCliGitHubSelection(userId: string, orgId: string): Promise<void> {
	return cliDb.deleteCliGitHubSelection(userId, orgId);
}

/**
 * Get active integration by provider types.
 */
export async function getActiveIntegrationByProviders(
	orgId: string,
	integrationIds: string[],
): Promise<{ id: string; connectionId: string | null } | null> {
	const integration = await cliDb.getActiveIntegrationById(orgId, integrationIds);
	if (!integration) return null;
	return { id: integration.id, connectionId: integration.connection_id };
}

/**
 * Store CLI GitHub selection for polling.
 */
export async function storeCliGitHubSelection(
	userId: string,
	orgId: string,
	connectionId: string,
): Promise<void> {
	const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
	return cliDb.upsertCliGitHubSelection(userId, orgId, connectionId, expiresAt);
}

/**
 * Validate that an integration exists for an organization.
 */
export async function integrationExistsForOrg(
	integrationId: string,
	orgId: string,
): Promise<boolean> {
	return cliDb.integrationExistsForOrg(integrationId, orgId);
}

// ============================================
// CLI Session Creation (combined flow)
// ============================================

export interface CreateCliSessionFullInput {
	sessionId: string;
	userId: string;
	orgId: string;
	localPathHash: string;
	displayName?: string;
	sandboxProvider: string;
}

export interface CreateCliSessionFullResult {
	sessionId: string;
	prebuildId: string;
	hasSnapshot: boolean;
}

/**
 * Create a CLI session with all required records.
 *
 * 1. Find or create device-scoped prebuild
 * 2. Find or create local repo record
 * 3. Link repo to prebuild
 * 4. Create session with type "cli"
 */
export async function createCliSessionFull(
	input: CreateCliSessionFullInput,
): Promise<CreateCliSessionFullResult> {
	const { sessionId, userId, orgId, localPathHash, displayName, sandboxProvider } = input;

	// 1. Find or create prebuild (device-scoped)
	let prebuildId: string;
	let snapshotId: string | null = null;

	const existingPrebuild = await cliDb.getCliPrebuild(userId, localPathHash);

	if (existingPrebuild) {
		prebuildId = existingPrebuild.id;
		snapshotId = existingPrebuild.snapshot_id;
	} else {
		const newPrebuild = await cliDb.createCliPrebuildPending({
			userId,
			localPathHash,
			sandboxProvider,
		});
		prebuildId = newPrebuild.id;
	}

	// 2. Find or create local repo
	let repoId: string;

	const existingRepo = await cliDb.findLocalRepo(orgId, localPathHash);

	if (existingRepo) {
		repoId = existingRepo.id;
	} else {
		const newRepo = await cliDb.createLocalRepo({
			organizationId: orgId,
			addedBy: userId,
			localPathHash,
			displayName: displayName || "Local Directory",
		});
		repoId = newRepo.id;
	}

	// 3. Link repo to prebuild (upsert to avoid race conditions)
	try {
		await cliDb.upsertPrebuildRepo({
			prebuildId,
			repoId,
			workspacePath: ".",
		});
	} catch (error) {
		// Non-fatal - log and continue
		console.error("Failed to link repo to prebuild:", error);
	}

	// 4. Create session with type "cli"
	await cliDb.createCliSessionWithPrebuild({
		id: sessionId,
		prebuildId,
		organizationId: orgId,
		createdBy: userId,
		sessionType: "cli",
		clientType: "cli",
		status: "pending",
		sandboxProvider,
		snapshotId,
	});

	return {
		sessionId,
		prebuildId,
		hasSnapshot: Boolean(snapshotId),
	};
}
