/**
 * Configurations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import { createConfigurationSnapshotBuildQueue } from "@proliferate/queue";
import type { ConfigurationServiceCommand, SandboxProviderType } from "@proliferate/shared";
import type { Configuration } from "@proliferate/shared/contracts/configurations";
import { getSandboxProvider } from "@proliferate/shared/providers";
import {
	parseConfigurationServiceCommands,
	parseServiceCommands,
	resolveServiceCommands,
} from "@proliferate/shared/sandbox";
import { encrypt, getEncryptionKey } from "../db/crypto";
import { getServicesLogger } from "../logger";
import * as repos from "../repos";
import * as secrets from "../secrets";
import * as sessions from "../sessions";
import * as configurationsDb from "./db";
import { toConfiguration, toConfigurationPartial, toConfigurations } from "./mapper";

// Lazy-initialized queue for configuration snapshot builds
let configSnapshotBuildQueue: ReturnType<typeof createConfigurationSnapshotBuildQueue> | null =
	null;

function getConfigSnapshotBuildQueue() {
	if (!configSnapshotBuildQueue) {
		configSnapshotBuildQueue = createConfigurationSnapshotBuildQueue();
	}
	return configSnapshotBuildQueue;
}

// ============================================
// Types
// ============================================

export interface CreateConfigurationInput {
	organizationId: string;
	userId: string;
	repoIds: string[];
	name?: string;
}

export interface CreateConfigurationResult {
	configurationId: string;
	repoCount: number;
}

export interface UpdateConfigurationInput {
	name?: string;
	notes?: string;
	routingDescription?: string | null;
}

export interface EffectiveServiceCommandsResult {
	source: "configuration" | "repo" | "none";
	commands: ConfigurationServiceCommand[];
	workspaces: string[];
}

export class ConfigurationNotFoundError extends Error {
	constructor(message = "Configuration not found") {
		super(message);
		this.name = "ConfigurationNotFoundError";
	}
}

export class ConfigurationForbiddenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationForbiddenError";
	}
}

export class ConfigurationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationValidationError";
	}
}

export class RepoNotInConfigurationError extends Error {
	constructor(message = "One or more repos not found") {
		super(message);
		this.name = "RepoNotInConfigurationError";
	}
}

export class SecretStorageError extends Error {
	constructor(key: string) {
		super(`Failed to store secret key: ${key}`);
		this.name = "SecretStorageError";
	}
}

export class ConfigurationRepoLinkError extends Error {
	constructor() {
		super("Failed to link repos to configuration");
		this.name = "ConfigurationRepoLinkError";
	}
}

// ============================================
// Service functions
// ============================================

/**
 * List configurations for an organization.
 * Filters to only include configurations with repos in the given org.
 */
export async function listConfigurations(orgId: string, status?: string): Promise<Configuration[]> {
	const rows = await configurationsDb.listAll(status);

	// Filter to only configurations that have repos in this org
	const filteredRows = rows.filter((p) =>
		p.configurationRepos?.some((pr) => pr.repo?.organizationId === orgId),
	);

	return toConfigurations(filteredRows);
}

/**
 * Get a single configuration by ID.
 */
export async function getConfiguration(id: string): Promise<Configuration | null> {
	const row = await configurationsDb.findByIdFull(id);
	if (!row) return null;
	return toConfiguration(row);
}

/**
 * Create a new configuration with repos.
 *
 * @throws ConfigurationValidationError if no repos provided
 * @throws RepoNotInConfigurationError if repos not found
 * @throws ConfigurationForbiddenError if unauthorized access to repo
 */
export async function createConfiguration(
	input: CreateConfigurationInput,
): Promise<CreateConfigurationResult> {
	const { organizationId, userId, repoIds, name } = input;

	if (!repoIds || repoIds.length === 0) {
		throw new ConfigurationValidationError("At least one repo is required");
	}

	// Verify repos exist and belong to organization
	const repos = await configurationsDb.getReposByIds(repoIds);

	if (!repos || repos.length !== repoIds.length) {
		throw new RepoNotInConfigurationError("One or more repos not found");
	}

	for (const repo of repos) {
		if (repo.organizationId !== organizationId) {
			throw new ConfigurationForbiddenError("Unauthorized access to repo");
		}
	}

	// Default name to repo name(s) if not provided
	const defaultName =
		name || repos.map((r) => r.githubRepoName?.split("/").pop() || r.id).join(", ");

	// Create configuration record
	const configurationId = randomUUID();
	await configurationsDb.create({
		id: configurationId,
		name: defaultName,
		createdBy: userId,
		sandboxProvider: env.DEFAULT_SANDBOX_PROVIDER,
	});

	// Create configuration_repos entries with derived workspace paths
	const configurationRepos = repoIds.map((repoId) => {
		const repo = repos.find((r) => r.id === repoId);
		const repoName = repo?.githubRepoName?.split("/").pop() || repoId;
		return {
			configurationId,
			repoId,
			workspacePath: repoIds.length === 1 ? "." : repoName,
		};
	});

	try {
		await configurationsDb.createConfigurationRepos(configurationRepos);
	} catch (error) {
		// Rollback: delete the configuration if junction creation fails
		await configurationsDb.deleteById(configurationId);
		throw new ConfigurationRepoLinkError();
	}

	// Tightly coupled: configuration creation always triggers snapshot build
	void requestConfigurationSnapshotBuild(configurationId);

	return {
		configurationId,
		repoCount: repoIds.length,
	};
}

/**
 * Attach a repo to a configuration.
 *
 * @throws ConfigurationNotFoundError if configuration not found
 * @throws RepoNotInConfigurationError if repo not found
 * @throws ConfigurationForbiddenError if unauthorized access to repo
 */
export async function attachRepo(
	configurationId: string,
	repoId: string,
	orgId: string,
): Promise<void> {
	// Verify configuration belongs to org
	const belongs = await configurationBelongsToOrg(configurationId, orgId);
	if (!belongs) {
		// For new configurations with no repos yet, verify the configuration exists
		const config = await configurationsDb.findByIdForSession(configurationId);
		if (!config) throw new ConfigurationNotFoundError();
	}

	// Verify repo exists
	const repos = await configurationsDb.getReposByIds([repoId]);
	if (!repos.length) throw new RepoNotInConfigurationError("Repo not found");
	if (repos[0].organizationId !== orgId)
		throw new ConfigurationForbiddenError("Unauthorized access to repo");

	// Check if already attached
	const alreadyAttached = await configurationsDb.configurationContainsRepo(configurationId, repoId);
	if (alreadyAttached) return;

	// Derive workspace path
	const repoName = repos[0].githubRepoName?.split("/").pop() || repoId;

	// Check if this is the only repo (use "." for workspace path) or not
	const existingRepos = await configurationsDb.getConfigurationReposWithDetails(configurationId);
	const workspacePath = existingRepos.length === 0 ? "." : repoName;

	await configurationsDb.createSingleConfigurationRepo(configurationId, repoId, workspacePath);
}

/**
 * Detach a repo from a configuration.
 *
 * @throws ConfigurationNotFoundError if configuration not found
 */
export async function detachRepo(
	configurationId: string,
	repoId: string,
	orgId: string,
): Promise<void> {
	const belongs = await configurationBelongsToOrg(configurationId, orgId);
	if (!belongs) throw new ConfigurationNotFoundError();

	await configurationsDb.deleteConfigurationRepo(configurationId, repoId);
}

/**
 * Update a configuration.
 *
 * @throws ConfigurationValidationError if no fields to update
 */
export async function updateConfiguration(
	id: string,
	input: UpdateConfigurationInput,
): Promise<Partial<Configuration>> {
	if (
		input.name === undefined &&
		input.notes === undefined &&
		input.routingDescription === undefined
	) {
		throw new ConfigurationValidationError("No fields to update");
	}

	const updated = await configurationsDb.update(id, input);
	return toConfigurationPartial(updated);
}

/**
 * Delete a configuration.
 */
export async function deleteConfiguration(id: string): Promise<boolean> {
	await configurationsDb.deleteById(id);
	return true;
}

/**
 * Check if a configuration exists.
 */
export async function configurationExists(id: string): Promise<boolean> {
	const configuration = await configurationsDb.findById(id);
	return !!configuration;
}

/**
 * Check if a configuration belongs to an organization (via its linked repos).
 */
export async function configurationBelongsToOrg(
	configurationId: string,
	orgId: string,
): Promise<boolean> {
	const configuration = await configurationsDb.findById(configurationId);
	if (!configuration) return false;
	return configuration.configurationRepos.some((pr) => pr.repo?.organizationId === orgId);
}

async function assertConfigurationBelongsToOrg(
	configurationId: string,
	orgId: string,
): Promise<void> {
	const belongsToOrg = await configurationBelongsToOrg(configurationId, orgId);
	if (!belongsToOrg) {
		throw new ConfigurationNotFoundError();
	}
}

export async function getConfigurationForOrg(
	configurationId: string,
	orgId: string,
): Promise<Configuration> {
	await assertConfigurationBelongsToOrg(configurationId, orgId);
	const configuration = await getConfiguration(configurationId);
	if (!configuration) {
		throw new ConfigurationNotFoundError();
	}
	return configuration;
}

export async function createConfigurationForOrg(input: {
	organizationId: string;
	userId: string;
	repoIds?: string[];
	legacyRepos?: Array<{ repoId: string }>;
	name?: string;
}): Promise<CreateConfigurationResult> {
	// Normalize: support both new repoIds[] and legacy repos[] format
	const resolvedRepoIds = input.repoIds || input.legacyRepos?.map((r) => r.repoId);
	if (!resolvedRepoIds || resolvedRepoIds.length === 0) {
		throw new ConfigurationValidationError("At least one repo is required");
	}

	return createConfiguration({
		organizationId: input.organizationId,
		userId: input.userId,
		repoIds: resolvedRepoIds,
		name: input.name,
	});
}

export async function updateConfigurationForOrg(
	configurationId: string,
	orgId: string,
	input: UpdateConfigurationInput,
): Promise<Configuration> {
	await assertConfigurationBelongsToOrg(configurationId, orgId);
	await updateConfiguration(configurationId, input);

	const updated = await getConfiguration(configurationId);
	if (!updated) {
		throw new ConfigurationNotFoundError();
	}
	return updated;
}

export async function deleteConfigurationForOrg(
	configurationId: string,
	orgId: string,
): Promise<void> {
	await assertConfigurationBelongsToOrg(configurationId, orgId);
	await deleteConfiguration(configurationId);
}

export async function getConfigurationServiceCommandsForOrg(
	configurationId: string,
	orgId: string,
): Promise<ConfigurationServiceCommand[]> {
	await assertConfigurationBelongsToOrg(configurationId, orgId);
	const row = await configurationsDb.getConfigurationServiceCommands(configurationId);
	return parseConfigurationServiceCommands(row?.serviceCommands);
}

export async function getConfigurationEnvFilesForOrg(
	configurationId: string,
	orgId: string,
): Promise<unknown | null> {
	await assertConfigurationBelongsToOrg(configurationId, orgId);
	const envFiles = await configurationsDb.getConfigurationEnvFiles(configurationId);
	return envFiles ?? null;
}

export async function updateConfigurationServiceCommandsForOrg(input: {
	configurationId: string;
	orgId: string;
	updatedBy: string;
	serviceCommands: ConfigurationServiceCommand[];
}): Promise<void> {
	await assertConfigurationBelongsToOrg(input.configurationId, input.orgId);
	await configurationsDb.updateConfigurationServiceCommands({
		configurationId: input.configurationId,
		serviceCommands: input.serviceCommands,
		updatedBy: input.updatedBy,
	});
}

export async function attachRepoForOrg(
	configurationId: string,
	repoId: string,
	orgId: string,
): Promise<void> {
	await attachRepo(configurationId, repoId, orgId);
}

export async function detachRepoForOrg(
	configurationId: string,
	repoId: string,
	orgId: string,
): Promise<void> {
	await detachRepo(configurationId, repoId, orgId);
}

/**
 * Get the effective service commands for a configuration, using the same
 * resolution logic as the gateway runtime: configuration overrides win if
 * non-empty, otherwise per-repo defaults are merged with workspace context.
 */
export async function getEffectiveServiceCommands(
	configurationId: string,
): Promise<EffectiveServiceCommandsResult> {
	const [configurationRow, repoRows] = await Promise.all([
		configurationsDb.getConfigurationServiceCommands(configurationId),
		configurationsDb.getConfigurationReposWithDetails(configurationId),
	]);

	const repoSpecs = repoRows.map((r) => ({
		workspacePath: r.workspacePath,
		serviceCommands: parseServiceCommands(r.repo?.serviceCommands),
	}));

	const commands = resolveServiceCommands(configurationRow?.serviceCommands, repoSpecs);

	const configCmds = parseConfigurationServiceCommands(configurationRow?.serviceCommands);
	const hasRepoDefaults = repoSpecs.some((r) => r.serviceCommands.length > 0);
	const source: EffectiveServiceCommandsResult["source"] =
		configCmds.length > 0 ? "configuration" : hasRepoDefaults ? "repo" : "none";

	const workspaces = [...new Set(repoRows.map((r) => r.workspacePath))];

	return { source, commands, workspaces };
}

// ============================================
// Re-exported DB types for external consumers
// ============================================

export type {
	ConfigurationRow,
	ConfigurationRepoRow,
	RepoBasicRow,
	ConfigurationForSessionRow,
	ConfigurationRepoDetailRow,
	RepoConfigurationRow,
	ConfigurationRepoWithConfigurationRow,
	SnapshotRepoRow,
	ConfigurationWithRelationsRow,
	ConfigurationWithOrgRow,
	ManagedConfigurationRow,
	RepoWithNameRow,
	ConfigurationSnapshotBuildInfoRow,
	ConfigurationCandidateRow,
} from "./db";

// Re-export input types
export type {
	CreateConfigurationInput as DbCreateConfigurationInput,
	CreateConfigurationRepoInput,
	UpdateConfigurationInput as DbUpdateConfigurationInput,
	CreateConfigurationFullInput,
	SnapshotRow,
} from "../types/configurations";

// ============================================
// Thin service wrappers for DB operations
// (Route all external access through service layer)
// ============================================

/**
 * Get configuration by ID for session creation.
 */
export async function findByIdForSession(id: string) {
	return configurationsDb.findByIdForSession(id);
}

/**
 * Get configuration repos with full repo details for session creation.
 */
export async function getConfigurationReposWithDetails(configurationId: string) {
	return configurationsDb.getConfigurationReposWithDetails(configurationId);
}

/**
 * Get configuration env file spec.
 */
export async function getConfigurationEnvFiles(configurationId: string) {
	return configurationsDb.getConfigurationEnvFiles(configurationId);
}

/**
 * Update configuration-level env file spec.
 */
export async function updateConfigurationEnvFiles(input: {
	configurationId: string;
	envFiles: unknown;
	updatedBy: string;
}) {
	return configurationsDb.updateConfigurationEnvFiles(input);
}

/**
 * Get configuration-level service commands.
 */
export async function getConfigurationServiceCommands(configurationId: string) {
	return configurationsDb.getConfigurationServiceCommands(configurationId);
}

/**
 * Update configuration-level service commands.
 */
export async function updateConfigurationServiceCommands(input: {
	configurationId: string;
	serviceCommands: unknown;
	updatedBy: string;
}) {
	return configurationsDb.updateConfigurationServiceCommands(input);
}

/**
 * Update configuration snapshot_id only if currently null.
 */
export async function updateSnapshotIdIfNull(configurationId: string, snapshotId: string) {
	return configurationsDb.updateSnapshotIdIfNull(configurationId, snapshotId);
}

/**
 * Low-level configuration update (used by gateway snapshot flow).
 */
export async function update(
	id: string,
	input: import("../types/configurations").UpdateConfigurationInput,
) {
	return configurationsDb.update(id, input);
}

/**
 * Create a new configuration with full details (for finalize).
 */
export async function createConfigurationFull(
	input: import("../types/configurations").CreateConfigurationFullInput,
) {
	return configurationsDb.createFull(input);
}

/**
 * Check if a configuration contains a specific repo.
 */
export async function configurationContainsRepo(configurationId: string, repoId: string) {
	return configurationsDb.configurationContainsRepo(configurationId, repoId);
}

/**
 * Create a single configuration_repo junction entry.
 */
export async function createSingleConfigurationRepo(
	configurationId: string,
	repoId: string,
	workspacePath: string,
) {
	return configurationsDb.createSingleConfigurationRepo(configurationId, repoId, workspacePath);
}

/**
 * Delete a configuration_repo junction entry.
 */
export async function deleteConfigurationRepo(configurationId: string, repoId: string) {
	return configurationsDb.deleteConfigurationRepo(configurationId, repoId);
}

/**
 * List configurations for a specific repo.
 */
export async function listByRepoId(repoId: string) {
	return configurationsDb.listByRepoId(repoId);
}

/**
 * Get configuration_repos with configuration data for a specific repo.
 */
export async function getConfigurationReposWithConfigurations(repoId: string) {
	return configurationsDb.getConfigurationReposWithConfigurations(repoId);
}

/**
 * Get repos linked to a configuration.
 */
export async function getReposForConfiguration(configurationId: string) {
	return configurationsDb.getReposForConfiguration(configurationId);
}

/**
 * Get a configuration by ID with minimal repos (for auth check).
 */
export async function findById(id: string) {
	return configurationsDb.findById(id);
}

/**
 * Get a configuration by ID with full relations.
 */
export async function findByIdFull(id: string) {
	return configurationsDb.findByIdFull(id);
}

/**
 * Find managed configurations with their repos.
 */
export async function findManagedConfigurations() {
	return configurationsDb.findManagedConfigurations();
}

/**
 * Get repos for an organization by IDs (or all if no IDs provided).
 */
export async function getReposForManagedConfiguration(orgId: string, repoIds?: string[]) {
	return configurationsDb.getReposForManagedConfiguration(orgId, repoIds);
}

/**
 * Create a managed configuration record.
 */
export async function createManagedConfiguration(
	input: import("../types/configurations").CreateManagedConfigurationInput,
) {
	return configurationsDb.createManagedConfiguration(input);
}

/**
 * Create configuration_repos junction entries.
 */
export async function createConfigurationRepos(
	entries: import("../types/configurations").CreateConfigurationRepoInput[],
) {
	return configurationsDb.createConfigurationRepos(entries);
}

/**
 * Get configuration snapshot build info (for worker).
 */
export async function getConfigurationSnapshotBuildInfo(configurationId: string) {
	return configurationsDb.getConfigurationSnapshotBuildInfo(configurationId);
}

/**
 * Mark a configuration as building (snapshot build in progress).
 */
export async function markConfigurationSnapshotBuilding(configurationId: string) {
	return configurationsDb.markConfigurationSnapshotBuilding(configurationId);
}

/**
 * Mark a configuration snapshot as default (auto-built with repos cloned).
 */
export async function markConfigurationSnapshotDefault(
	configurationId: string,
	snapshotId: string,
) {
	return configurationsDb.markConfigurationSnapshotDefault(configurationId, snapshotId);
}

/**
 * Mark a configuration as default without a snapshot.
 */
export async function markConfigurationDefaultNoSnapshot(configurationId: string) {
	return configurationsDb.markConfigurationDefaultNoSnapshot(configurationId);
}

/**
 * Mark a configuration snapshot build as failed.
 */
export async function markConfigurationSnapshotFailed(configurationId: string, error: string) {
	return configurationsDb.markConfigurationSnapshotFailed(configurationId, error);
}

/**
 * Get configurations by IDs with routing metadata for the selector service.
 */
export async function getConfigurationCandidates(
	configurationIds: string[],
	organizationId: string,
) {
	return configurationsDb.getConfigurationCandidates(configurationIds, organizationId);
}

/**
 * List configurations with repos and setup sessions (raw DB rows).
 */
export async function listAll(status?: string) {
	return configurationsDb.listAll(status);
}

/**
 * Request a configuration snapshot build (fire-and-forget).
 *
 * With E2B, snapshots are created via setup sessions. This enqueues a job
 * that marks the configuration as default if no snapshot exists yet.
 */
export async function requestConfigurationSnapshotBuild(
	configurationId: string,
	options?: { force?: boolean },
): Promise<void> {
	try {
		const queue = getConfigSnapshotBuildQueue();
		const jobId = `config:${configurationId}:${Date.now()}`;
		await queue.add(
			`config:${configurationId}`,
			{ configurationId, force: options?.force ?? false },
			{ jobId },
		);
	} catch (error) {
		getServicesLogger()
			.child({ module: "configurations" })
			.warn({ err: error, configurationId }, "Failed to enqueue configuration snapshot build");
	}
}

// ============================================
// Finalize Setup
// ============================================

const logger = getServicesLogger().child({ module: "configurations" });

export class SessionNotFoundError extends Error {
	constructor() {
		super("Session not found");
		this.name = "SessionNotFoundError";
	}
}

export class SetupSessionRequiredError extends Error {
	constructor() {
		super("Only setup sessions can be finalized");
		this.name = "SetupSessionRequiredError";
	}
}

export class NoSandboxError extends Error {
	constructor() {
		super("No sandbox associated with session");
		this.name = "NoSandboxError";
	}
}

export class RepoIdRequiredError extends Error {
	constructor(message?: string) {
		super(message ?? "repoId is required when session has no configuration");
		this.name = "RepoIdRequiredError";
	}
}

export class AmbiguousRepoError extends Error {
	constructor() {
		super("repoId required for multi-repo secret persistence");
		this.name = "AmbiguousRepoError";
	}
}

export class SnapshotFailedError extends Error {
	constructor(cause?: unknown) {
		super(`Failed to create snapshot: ${cause instanceof Error ? cause.message : "Unknown error"}`);
		this.name = "SnapshotFailedError";
	}
}

export class RepoNotFoundError extends Error {
	constructor() {
		super("Repo not found");
		this.name = "RepoNotFoundError";
	}
}

export class SessionRepoMismatchError extends Error {
	constructor() {
		super("Session not found for this repo");
		this.name = "SessionRepoMismatchError";
	}
}

export interface FinalizeSetupInput {
	repoId?: string;
	sessionId: string;
	secrets?: Record<string, string>;
	name?: string;
	notes?: string;
	updateSnapshotId?: string;
	keepRunning?: boolean;
	userId: string;
	orgId: string;
}

export interface FinalizeSetupResult {
	configurationId: string;
	snapshotId: string;
	success: boolean;
}

/**
 * Resolve the target repoId for finalization.
 *
 * Decision tree:
 * 1. If caller supplied repoId: use it.
 * 2. Else if session.repoId is non-null: use it.
 * 3. Else if session.configurationId is null: reject.
 * 4. Else load configurationRepos:
 *    - Exactly one repo: use that repo.
 *    - Multiple repos + secrets payload non-empty: reject (ambiguous).
 *    - Multiple repos + no secrets: return the first repo (secrets skipped by caller).
 *    - Zero repos: reject.
 */
async function resolveRepoId(
	explicitRepoId: string | undefined,
	session: { repoId: string | null; configurationId: string | null },
	hasSecrets: boolean,
): Promise<string> {
	if (explicitRepoId) return explicitRepoId;
	if (session.repoId) return session.repoId;
	if (!session.configurationId) {
		throw new RepoIdRequiredError();
	}

	const configRepos = await configurationsDb.getConfigurationReposWithDetails(
		session.configurationId,
	);
	const repoIds = configRepos.map((cr) => cr.repo?.id).filter(Boolean) as string[];
	if (repoIds.length === 0) {
		throw new RepoIdRequiredError("Configuration has no repos");
	}
	if (repoIds.length === 1) {
		return repoIds[0];
	}
	// Multiple repos
	if (hasSecrets) {
		throw new AmbiguousRepoError();
	}
	return repoIds[0];
}

/**
 * Finalize a setup session: snapshot the sandbox, store secrets,
 * and create or update the configuration.
 *
 * @throws SessionNotFoundError
 * @throws SetupSessionRequiredError
 * @throws NoSandboxError
 * @throws RepoIdRequiredError
 * @throws AmbiguousRepoError
 * @throws SnapshotFailedError
 * @throws RepoNotFoundError
 * @throws SessionRepoMismatchError
 */
export async function finalizeSetup(input: FinalizeSetupInput): Promise<FinalizeSetupResult> {
	const {
		repoId: explicitRepoId,
		sessionId,
		secrets: inputSecrets = {},
		name,
		notes,
		updateSnapshotId,
		keepRunning = true,
		userId,
		orgId,
	} = input;

	// 1. Get session
	const session = await sessions.findSessionByIdInternal(sessionId);

	if (!session || session.organizationId !== orgId) {
		throw new SessionNotFoundError();
	}

	if (session.sessionType !== "setup") {
		throw new SetupSessionRequiredError();
	}

	const sandboxId = session.sandboxId;
	if (!sandboxId) {
		throw new NoSandboxError();
	}

	// 2. Resolve repoId (may be derived from session/configuration)
	const repoId = await resolveRepoId(
		explicitRepoId,
		{ repoId: session.repoId, configurationId: session.configurationId },
		Object.keys(inputSecrets).length > 0,
	);

	// Verify repoId matches session or session's configuration contains this repo
	const sessionBelongsToRepo = session.repoId === repoId;
	let sessionBelongsToConfiguration = false;

	if (session.configurationId && !sessionBelongsToRepo) {
		sessionBelongsToConfiguration = await configurationsDb.configurationContainsRepo(
			session.configurationId,
			repoId,
		);
	}

	if (!sessionBelongsToRepo && !sessionBelongsToConfiguration) {
		throw new SessionRepoMismatchError();
	}

	// 3. Take filesystem snapshot via provider
	const provider = getSandboxProvider(session.sandboxProvider as SandboxProviderType);
	let snapshotId: string | null = null;

	try {
		const snapshotResult = await provider.snapshot(sessionId, sandboxId);
		snapshotId = snapshotResult.snapshotId;
	} catch (err) {
		throw new SnapshotFailedError(err);
	}

	// Get the repo to find organization_id
	const organizationId = await repos.getOrganizationId(repoId);

	if (!organizationId) {
		throw new RepoNotFoundError();
	}

	// 4. Encrypt and store secrets
	if (Object.keys(inputSecrets).length > 0) {
		const encryptionKey = getEncryptionKey();

		for (const [key, value] of Object.entries(inputSecrets)) {
			const encryptedValue = encrypt(value, encryptionKey);

			const stored = await secrets.upsertSecretByRepoAndKey({
				repoId,
				organizationId,
				key,
				encryptedValue,
			});
			if (!stored) {
				throw new SecretStorageError(key);
			}
		}
	}

	if (!snapshotId) {
		throw new SnapshotFailedError(null);
	}

	let configurationId: string;

	// Determine which configuration to update
	const existingConfigurationId = updateSnapshotId || session.configurationId;

	if (existingConfigurationId) {
		// Update existing configuration record
		configurationId = existingConfigurationId;
		await configurationsDb.update(existingConfigurationId, {
			snapshotId,
			status: "ready",
			name: name || null,
			notes: notes || null,
		});
	} else {
		// Create new configuration record
		configurationId = randomUUID();
		await configurationsDb.createFull({
			id: configurationId,
			snapshotId,
			status: "ready",
			name: name || null,
			notes: notes || null,
			createdBy: userId,
			sandboxProvider: provider.type,
		});

		// Create configuration_repos entry for this repo
		const repoName = repoId.slice(0, 8);
		const githubRepoName = await repos.getGithubRepoName(repoId);
		const workspacePath = githubRepoName?.split("/")[1] || repoName;

		await configurationsDb.createSingleConfigurationRepo(configurationId, repoId, workspacePath);

		// Update session with the new configuration_id
		await sessions.updateSessionConfigurationId(sessionId, configurationId);
	}

	// 5. Terminate sandbox and end session (unless keepRunning)
	if (!keepRunning) {
		try {
			await provider.terminate(sessionId, sandboxId);
		} catch (err) {
			logger.warn({ err, sessionId, sandboxId }, "Failed to terminate sandbox");
		}

		await sessions.markSessionStopped(sessionId);
	}

	return {
		configurationId,
		snapshotId,
		success: true,
	};
}
