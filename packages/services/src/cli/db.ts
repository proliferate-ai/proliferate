/**
 * CLI DB operations.
 *
 * Raw Drizzle queries - no business logic.
 */

import {
	type InferSelectModel,
	and,
	cliDeviceCodes,
	cliGithubSelections,
	configurationRepos,
	configurations,
	desc,
	eq,
	getDb,
	inArray,
	integrations,
	member,
	organization,
	repoConnections,
	repos,
	sessions,
	user,
	userSshKeys,
} from "../db/client";
import { toIsoString, toIsoStringRequired } from "../db/serialize";
import type {
	CliGitHubSelectionRow,
	CliPrebuildRow,
	CliRepoConnectionRow,
	CliRepoRow,
	CliSessionFullRow,
	CliSessionRow,
	CreateCliSessionInput,
	CreateCliSessionWithPrebuildInput,
	DeviceCodeRow,
	GitHubIntegrationForTokenRow,
	GitHubIntegrationStatusRow,
	SshKeyRow,
} from "../types/cli";

// ============================================
// Types
// ============================================

export type DeviceCodeDbRow = InferSelectModel<typeof cliDeviceCodes>;
export type SshKeyDbRow = InferSelectModel<typeof userSshKeys>;
export type CliGitHubSelectionDbRow = InferSelectModel<typeof cliGithubSelections>;

// ============================================
// Device Code Queries
// ============================================

/**
 * Create a device code for CLI authentication.
 */
export async function createDeviceCode(input: {
	userCode: string;
	deviceCode: string;
	expiresAt: string;
	status: string;
	userId: string | null;
}): Promise<void> {
	const db = getDb();
	await db.insert(cliDeviceCodes).values({
		userCode: input.userCode,
		deviceCode: input.deviceCode,
		expiresAt: new Date(input.expiresAt),
		status: input.status,
		userId: input.userId,
	});
}

/**
 * Find device code by user code.
 */
export async function findDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeRow | null> {
	const db = getDb();
	const row = await db.query.cliDeviceCodes.findFirst({
		where: and(eq(cliDeviceCodes.userCode, userCode), eq(cliDeviceCodes.status, "pending")),
	});

	if (!row) return null;

	return {
		id: row.id,
		user_code: row.userCode,
		device_code: row.deviceCode,
		expires_at: toIsoStringRequired(row.expiresAt),
		status: row.status,
		user_id: row.userId,
		org_id: row.orgId,
		authorized_at: toIsoString(row.authorizedAt) ?? null,
	};
}

/**
 * Find device code by device code.
 */
export async function findDeviceCodeByDeviceCode(
	deviceCode: string,
): Promise<DeviceCodeRow | null> {
	const db = getDb();
	const row = await db.query.cliDeviceCodes.findFirst({
		where: eq(cliDeviceCodes.deviceCode, deviceCode),
	});

	if (!row) return null;

	return {
		id: row.id,
		user_code: row.userCode,
		device_code: row.deviceCode,
		expires_at: toIsoStringRequired(row.expiresAt),
		status: row.status,
		user_id: row.userId,
		org_id: row.orgId,
		authorized_at: toIsoString(row.authorizedAt) ?? null,
	};
}

/**
 * Authorize a device code.
 */
export async function authorizeDeviceCode(
	id: string,
	userId: string,
	orgId: string | undefined,
): Promise<void> {
	const db = getDb();
	await db
		.update(cliDeviceCodes)
		.set({
			status: "authorized",
			userId: userId,
			orgId: orgId ?? null,
			authorizedAt: new Date(),
		})
		.where(eq(cliDeviceCodes.id, id));
}

/**
 * Delete a device code.
 */
export async function deleteDeviceCode(id: string): Promise<void> {
	const db = getDb();
	await db.delete(cliDeviceCodes).where(eq(cliDeviceCodes.id, id));
}

// ============================================
// SSH Key Queries
// ============================================

/**
 * List SSH keys for a user.
 */
export async function listSshKeys(userId: string): Promise<SshKeyRow[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: userSshKeys.id,
			fingerprint: userSshKeys.fingerprint,
			name: userSshKeys.name,
			createdAt: userSshKeys.createdAt,
		})
		.from(userSshKeys)
		.where(eq(userSshKeys.userId, userId))
		.orderBy(desc(userSshKeys.createdAt));

	return rows.map((row) => ({
		id: row.id,
		fingerprint: row.fingerprint,
		name: row.name,
		created_at: toIsoString(row.createdAt) ?? null,
	}));
}

/**
 * Get SSH key public keys for a user.
 */
export async function getSshPublicKeys(userId: string): Promise<{ public_key: string }[]> {
	const db = getDb();
	const rows = await db
		.select({ publicKey: userSshKeys.publicKey })
		.from(userSshKeys)
		.where(eq(userSshKeys.userId, userId));

	return rows.map((row) => ({ public_key: row.publicKey }));
}

/**
 * Create an SSH key.
 */
export async function createSshKey(input: {
	userId: string;
	publicKey: string;
	fingerprint: string;
	name: string | null;
}): Promise<SshKeyRow> {
	const db = getDb();
	const [row] = await db
		.insert(userSshKeys)
		.values({
			userId: input.userId,
			publicKey: input.publicKey.trim(),
			fingerprint: input.fingerprint,
			name: input.name,
		})
		.returning({
			id: userSshKeys.id,
			fingerprint: userSshKeys.fingerprint,
			name: userSshKeys.name,
			createdAt: userSshKeys.createdAt,
		});

	return {
		id: row.id,
		fingerprint: row.fingerprint,
		name: row.name,
		created_at: toIsoString(row.createdAt) ?? null,
	};
}

/**
 * Delete all SSH keys for a user.
 */
export async function deleteAllSshKeys(userId: string): Promise<void> {
	const db = getDb();
	await db.delete(userSshKeys).where(eq(userSshKeys.userId, userId));
}

/**
 * Delete a specific SSH key.
 */
export async function deleteSshKey(id: string, userId: string): Promise<{ id: string } | null> {
	const db = getDb();
	const result = await db
		.delete(userSshKeys)
		.where(and(eq(userSshKeys.id, id), eq(userSshKeys.userId, userId)))
		.returning({ id: userSshKeys.id });

	if (result.length === 0) return null;
	return result[0];
}

// ============================================
// Repo Queries
// ============================================

/**
 * Find a local repo by path hash.
 */
export async function findLocalRepo(
	orgId: string,
	localPathHash: string,
): Promise<CliRepoRow | null> {
	const db = getDb();
	const row = await db.query.repos.findFirst({
		columns: {
			id: true,
			localPathHash: true,
			source: true,
			githubRepoName: true,
		},
		where: and(
			eq(repos.organizationId, orgId),
			eq(repos.localPathHash, localPathHash),
			eq(repos.source, "local"),
		),
	});

	if (!row) return null;

	return {
		id: row.id,
		local_path_hash: row.localPathHash,
		source: row.source,
		github_repo_name: row.githubRepoName,
	};
}

/**
 * Get repo connection for a repo.
 */
export async function getRepoConnection(repoId: string): Promise<CliRepoConnectionRow | null> {
	const db = getDb();
	const row = await db.query.repoConnections.findFirst({
		where: eq(repoConnections.repoId, repoId),
		with: {
			integration: {
				columns: {
					id: true,
					integrationId: true,
					displayName: true,
					status: true,
				},
			},
		},
	});

	if (!row) return null;

	return {
		id: row.id,
		integration_id: row.integrationId,
		integrations: row.integration
			? {
					id: row.integration.id,
					integration_id: row.integration.integrationId,
					display_name: row.integration.displayName,
					status: row.integration.status ?? "active",
				}
			: null,
	};
}

/**
 * Create a local repo.
 */
export async function createLocalRepo(input: {
	organizationId: string;
	addedBy: string;
	localPathHash: string;
	displayName: string;
}): Promise<{ id: string }> {
	const db = getDb();
	const [row] = await db
		.insert(repos)
		.values({
			organizationId: input.organizationId,
			addedBy: input.addedBy,
			source: "local",
			localPathHash: input.localPathHash,
			githubRepoName: input.displayName || "Local Directory",
			githubRepoId: `local-${input.localPathHash}`,
			githubUrl: "",
		})
		.returning({ id: repos.id });

	return row;
}

/**
 * Update repo display name.
 */
export async function updateRepoDisplayName(repoId: string, displayName: string): Promise<void> {
	const db = getDb();
	await db.update(repos).set({ githubRepoName: displayName }).where(eq(repos.id, repoId));
}

/**
 * Delete all local repos for an organization.
 */
export async function deleteAllLocalRepos(orgId: string): Promise<{ count: number }> {
	const db = getDb();
	const result = await db
		.delete(repos)
		.where(and(eq(repos.organizationId, orgId), eq(repos.source, "local")))
		.returning({ id: repos.id });

	return { count: result.length };
}

/**
 * Delete repo connections for a repo.
 */
export async function deleteRepoConnections(repoId: string): Promise<void> {
	const db = getDb();
	await db.delete(repoConnections).where(eq(repoConnections.repoId, repoId));
}

/**
 * Create repo connection.
 */
export async function createRepoConnection(repoId: string, integrationId: string): Promise<void> {
	const db = getDb();
	await db.insert(repoConnections).values({
		repoId: repoId,
		integrationId: integrationId,
	});
}

// ============================================
// Session Queries
// ============================================

/**
 * List CLI sessions.
 */
export async function listCliSessions(
	orgId: string,
	localPathHash?: string,
): Promise<CliSessionRow[]> {
	const db = getDb();

	const conditions = [
		eq(sessions.organizationId, orgId),
		eq(sessions.origin, "cli"),
		eq(sessions.sessionType, "terminal"),
	];

	if (localPathHash) {
		conditions.push(eq(sessions.localPathHash, localPathHash));
	}

	const rows = await db
		.select({
			id: sessions.id,
			status: sessions.status,
			sessionType: sessions.sessionType,
			origin: sessions.origin,
			localPathHash: sessions.localPathHash,
			startedAt: sessions.startedAt,
			lastActivityAt: sessions.lastActivityAt,
		})
		.from(sessions)
		.where(and(...conditions))
		.orderBy(desc(sessions.startedAt));

	return rows.map((row) => ({
		id: row.id,
		status: row.status,
		session_type: row.sessionType,
		origin: row.origin,
		local_path_hash: row.localPathHash,
		started_at: toIsoString(row.startedAt) ?? null,
		last_activity_at: toIsoString(row.lastActivityAt) ?? null,
	}));
}

/**
 * Find existing resumable session.
 */
export async function findResumableSession(
	orgId: string,
	localPathHash: string,
): Promise<{
	id: string;
	status: string | null;
} | null> {
	const db = getDb();
	const row = await db.query.sessions.findFirst({
		where: and(
			eq(sessions.organizationId, orgId),
			eq(sessions.localPathHash, localPathHash),
			eq(sessions.origin, "cli"),
			eq(sessions.sessionType, "terminal"),
			inArray(sessions.status, ["running", "paused"]),
		),
		columns: {
			id: true,
			status: true,
		},
		orderBy: [desc(sessions.startedAt)],
	});

	return row ?? null;
}

// ============================================
// Prebuild Queries
// ============================================

/**
 * Get CLI prebuild by local path hash.
 */
export async function getCliPrebuild(
	userId: string,
	localPathHash: string,
): Promise<CliPrebuildRow | null> {
	const db = getDb();
	const row = await db.query.configurations.findFirst({
		where: and(eq(configurations.userId, userId), eq(configurations.localPathHash, localPathHash)),
		columns: {
			id: true,
			snapshotId: true,
			userId: true,
			localPathHash: true,
			createdAt: true,
		},
	});

	if (!row) return null;

	return {
		id: row.id,
		snapshot_id: row.snapshotId,
		user_id: row.userId,
		local_path_hash: row.localPathHash,
		created_at: toIsoString(row.createdAt) ?? null,
		sandbox_provider: null, // Field not in schema, returning null for compatibility
	};
}

/**
 * Upsert CLI prebuild.
 */
export async function upsertCliPrebuild(input: {
	userId: string;
	localPathHash: string;
	snapshotId: string;
	sandboxProvider: string;
}): Promise<CliPrebuildRow> {
	const db = getDb();
	const [row] = await db
		.insert(configurations)
		.values({
			userId: input.userId,
			localPathHash: input.localPathHash,
			snapshotId: input.snapshotId,
			status: "ready",
			name: "CLI Prebuild",
		})
		.onConflictDoUpdate({
			target: [configurations.userId, configurations.localPathHash],
			set: {
				snapshotId: input.snapshotId,
				status: "ready",
			},
		})
		.returning();

	return {
		id: row.id,
		snapshot_id: row.snapshotId,
		user_id: row.userId,
		local_path_hash: row.localPathHash,
		created_at: toIsoString(row.createdAt) ?? null,
		sandbox_provider: null, // Field not in schema
	};
}

/**
 * Delete CLI prebuild.
 */
export async function deleteCliPrebuild(userId: string, localPathHash: string): Promise<void> {
	const db = getDb();
	await db
		.delete(configurations)
		.where(and(eq(configurations.userId, userId), eq(configurations.localPathHash, localPathHash)));
}

/**
 * Create a new CLI prebuild with pending status.
 */
export async function createCliPrebuildPending(input: {
	userId: string;
	localPathHash: string;
	sandboxProvider: string;
}): Promise<{ id: string }> {
	const db = getDb();
	const [row] = await db
		.insert(configurations)
		.values({
			userId: input.userId,
			localPathHash: input.localPathHash,
			status: "pending",
			type: "cli",
			name: "CLI Prebuild",
		})
		.returning({ id: configurations.id });

	return row;
}

/**
 * Upsert prebuild_repos junction entry.
 */
export async function upsertPrebuildRepo(input: {
	prebuildId: string;
	repoId: string;
	workspacePath: string;
}): Promise<void> {
	const db = getDb();
	await db
		.insert(configurationRepos)
		.values({
			configurationId: input.prebuildId,
			repoId: input.repoId,
			workspacePath: input.workspacePath,
		})
		.onConflictDoUpdate({
			target: [configurationRepos.configurationId, configurationRepos.repoId],
			set: {
				workspacePath: input.workspacePath,
			},
		});
}

/**
 * Create a CLI session with prebuild.
 */
export async function createCliSessionWithPrebuild(
	input: CreateCliSessionWithPrebuildInput,
): Promise<void> {
	const db = getDb();
	await db.insert(sessions).values({
		id: input.id,
		prebuildId: input.prebuildId,
		organizationId: input.organizationId,
		createdBy: input.createdBy,
		sessionType: input.sessionType,
		clientType: input.clientType,
		status: input.status,
		snapshotId: input.snapshotId,
	});
}

// ============================================
// CLI Session Queries
// ============================================

/**
 * Create a CLI session.
 */
export async function createCliSession(input: CreateCliSessionInput): Promise<void> {
	const db = getDb();
	await db.insert(sessions).values({
		id: input.id,
		repoId: input.repoId,
		organizationId: input.organizationId,
		createdBy: input.createdBy,
		sessionType: input.sessionType,
		origin: input.origin,
		localPathHash: input.localPathHash,
		status: input.status,
		title: input.title,
	});
}

/**
 * Delete a session by ID.
 */
export async function deleteSession(sessionId: string): Promise<void> {
	const db = getDb();
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Update session with sandbox info.
 */
export async function updateSessionWithSandbox(
	sessionId: string,
	sandboxId: string | null,
	status: string,
	previewTunnelUrl: string | null,
): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({
			status,
			sandboxId: sandboxId,
			previewTunnelUrl,
		})
		.where(eq(sessions.id, sessionId));
}

/**
 * Get CLI sessions for termination (running or starting).
 */
export async function getCliSessionsForTermination(orgId: string): Promise<CliSessionFullRow[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: sessions.id,
			sandboxId: sessions.sandboxId,
			status: sessions.status,
			organizationId: sessions.organizationId,
		})
		.from(sessions)
		.where(
			and(
				eq(sessions.organizationId, orgId),
				eq(sessions.origin, "cli"),
				inArray(sessions.status, ["running", "starting"]),
			),
		);

	return rows.map((row) => ({
		id: row.id,
		sandbox_id: row.sandboxId,
		sandbox_provider: null, // Field not in schema
		status: row.status,
		organization_id: row.organizationId,
	}));
}

/**
 * Stop all CLI sessions for an organization.
 */
export async function stopAllCliSessions(orgId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ status: "stopped", endedAt: new Date() })
		.where(
			and(
				eq(sessions.organizationId, orgId),
				eq(sessions.origin, "cli"),
				inArray(sessions.status, ["running", "starting", "paused"]),
			),
		);
}

/**
 * Get a session by ID and organization (full details).
 */
export async function getSessionByIdAndOrg(
	sessionId: string,
	orgId: string,
): Promise<Record<string, unknown> | null> {
	const db = getDb();
	const row = await db.query.sessions.findFirst({
		where: and(eq(sessions.id, sessionId), eq(sessions.organizationId, orgId)),
	});

	if (!row) return null;

	// Convert to snake_case for API compatibility
	return {
		id: row.id,
		repo_id: row.repoId,
		organization_id: row.organizationId,
		created_by: row.createdBy,
		session_type: row.sessionType,
		status: row.status,
		sandbox_id: row.sandboxId,
		snapshot_id: row.snapshotId,
		prebuild_id: row.prebuildId,
		branch_name: row.branchName,
		base_commit_sha: row.baseCommitSha,
		parent_session_id: row.parentSessionId,
		initial_prompt: row.initialPrompt,
		title: row.title,
		automation_id: row.automationId,
		trigger_id: row.triggerId,
		trigger_event_id: row.triggerEventId,
		started_at: toIsoString(row.startedAt) ?? null,
		last_activity_at: toIsoString(row.lastActivityAt) ?? null,
		paused_at: toIsoString(row.pausedAt) ?? null,
		ended_at: toIsoString(row.endedAt) ?? null,
		idle_timeout_minutes: row.idleTimeoutMinutes,
		auto_delete_days: row.autoDeleteDays,
		origin: row.origin,
		local_path_hash: row.localPathHash,
		client_type: row.clientType,
		client_metadata: row.clientMetadata,
		coding_agent_session_id: row.codingAgentSessionId,
		open_code_tunnel_url: row.openCodeTunnelUrl,
		preview_tunnel_url: row.previewTunnelUrl,
		agent_config: row.agentConfig,
		system_prompt: row.systemPrompt,
		metered_through_at: toIsoString(row.meteredThroughAt) ?? null,
		billing_token_version: row.billingTokenVersion,
		last_seen_alive_at: toIsoString(row.lastSeenAliveAt) ?? null,
		alive_check_failures: row.aliveCheckFailures,
		pause_reason: row.pauseReason,
		stop_reason: row.stopReason,
		sandbox_expires_at: toIsoString(row.sandboxExpiresAt) ?? null,
		source: row.source,
	};
}

/**
 * Get session for termination (with sandbox info).
 */
export async function getSessionForTermination(
	sessionId: string,
	orgId: string,
): Promise<CliSessionFullRow | null> {
	const db = getDb();
	const row = await db.query.sessions.findFirst({
		where: and(eq(sessions.id, sessionId), eq(sessions.organizationId, orgId)),
		columns: {
			id: true,
			sandboxId: true,
			status: true,
			organizationId: true,
		},
	});

	if (!row) return null;

	return {
		id: row.id,
		sandbox_id: row.sandboxId,
		sandbox_provider: null, // Field not in schema
		status: row.status,
		organization_id: row.organizationId,
	};
}

/**
 * Stop a session by ID.
 */
export async function stopSession(sessionId: string): Promise<void> {
	const db = getDb();
	await db
		.update(sessions)
		.set({ status: "stopped", endedAt: new Date() })
		.where(eq(sessions.id, sessionId));
}

// ============================================
// User/Org Queries
// ============================================

/**
 * Get user's first organization membership.
 */
export async function getUserFirstOrganization(
	userId: string,
): Promise<{ organizationId: string } | null> {
	const db = getDb();
	const row = await db.query.member.findFirst({
		where: eq(member.userId, userId),
		columns: {
			organizationId: true,
		},
	});

	return row ?? null;
}

/**
 * Get user by ID.
 */
export async function getUser(
	userId: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
	const db = getDb();
	const row = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: {
			id: true,
			email: true,
			name: true,
		},
	});

	return row ?? null;
}

/**
 * Get organization by ID.
 */
export async function getOrganization(orgId: string): Promise<{ id: string; name: string } | null> {
	const db = getDb();
	const row = await db.query.organization.findFirst({
		where: eq(organization.id, orgId),
		columns: {
			id: true,
			name: true,
		},
	});

	return row ?? null;
}

/**
 * Check for GitHub integration.
 */
export async function hasGitHubIntegration(
	orgId: string,
	integrationIds: string[],
): Promise<boolean> {
	const normalized = integrationIds.filter(Boolean);
	if (normalized.length === 0) {
		return false;
	}

	const db = getDb();
	const row = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			inArray(integrations.integrationId, normalized),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
		},
	});

	return !!row;
}

// ============================================
// GitHub Integration Queries
// ============================================

/**
 * Get active GitHub integration for status check.
 */
export async function getActiveGitHubIntegration(
	orgId: string,
	integrationIds: string[],
): Promise<GitHubIntegrationStatusRow | null> {
	const db = getDb();
	const row = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			inArray(integrations.integrationId, integrationIds),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			displayName: true,
		},
	});

	if (!row) return null;

	return {
		id: row.id,
		display_name: row.displayName,
	};
}

/**
 * Get GitHub integration for token retrieval.
 */
export async function getGitHubIntegrationForToken(
	orgId: string,
	integrationId: string,
): Promise<GitHubIntegrationForTokenRow | null> {
	const db = getDb();
	const row = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			eq(integrations.id, integrationId),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			githubInstallationId: true,
			connectionId: true,
		},
	});

	if (!row) return null;

	return {
		id: row.id,
		github_installation_id: row.githubInstallationId ? Number(row.githubInstallationId) : null,
		connection_id: row.connectionId,
	};
}

/**
 * Get active GitHub integration by ID for connection check.
 */
export async function getActiveIntegrationById(
	orgId: string,
	integrationIds: string[],
): Promise<{ id: string; connection_id: string | null } | null> {
	const db = getDb();
	const row = await db.query.integrations.findFirst({
		where: and(
			eq(integrations.organizationId, orgId),
			inArray(integrations.integrationId, integrationIds),
			eq(integrations.status, "active"),
		),
		columns: {
			id: true,
			connectionId: true,
		},
	});

	if (!row) return null;

	return {
		id: row.id,
		connection_id: row.connectionId,
	};
}

// ============================================
// CLI GitHub Selections Queries
// ============================================

/**
 * Get CLI GitHub selection for a user/org.
 */
export async function getCliGitHubSelection(
	userId: string,
	orgId: string,
): Promise<CliGitHubSelectionRow | null> {
	const db = getDb();
	const row = await db.query.cliGithubSelections.findFirst({
		where: and(
			eq(cliGithubSelections.userId, userId),
			eq(cliGithubSelections.organizationId, orgId),
		),
		columns: {
			connectionId: true,
			expiresAt: true,
		},
	});

	if (!row) return null;

	return {
		connection_id: row.connectionId,
		expires_at: toIsoStringRequired(row.expiresAt),
	};
}

/**
 * Delete CLI GitHub selection for a user/org.
 */
export async function deleteCliGitHubSelection(userId: string, orgId: string): Promise<void> {
	const db = getDb();
	await db
		.delete(cliGithubSelections)
		.where(
			and(eq(cliGithubSelections.userId, userId), eq(cliGithubSelections.organizationId, orgId)),
		);
}

/**
 * Upsert CLI GitHub selection.
 */
export async function upsertCliGitHubSelection(
	userId: string,
	orgId: string,
	connectionId: string,
	expiresAt: string,
): Promise<void> {
	const db = getDb();
	await db
		.insert(cliGithubSelections)
		.values({
			userId: userId,
			organizationId: orgId,
			connectionId: connectionId,
			expiresAt: new Date(expiresAt),
		})
		.onConflictDoUpdate({
			target: [cliGithubSelections.userId, cliGithubSelections.organizationId],
			set: {
				connectionId: connectionId,
				expiresAt: new Date(expiresAt),
			},
		});
}

// ============================================
// Integration Validation Queries
// ============================================

/**
 * Validate that an integration exists for an organization.
 */
export async function integrationExistsForOrg(
	integrationId: string,
	orgId: string,
): Promise<boolean> {
	const db = getDb();
	const row = await db.query.integrations.findFirst({
		where: and(eq(integrations.id, integrationId), eq(integrations.organizationId, orgId)),
		columns: {
			id: true,
		},
	});

	return !!row;
}
