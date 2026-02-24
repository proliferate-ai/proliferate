/**
 * Configurations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import { createConfigurationSnapshotBuildQueue } from "@proliferate/queue";
import type { Configuration, ConfigurationServiceCommand, SandboxProviderType } from "@proliferate/shared";
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
 * @throws Error if repos not found or unauthorized
 */
export async function createConfiguration(
	input: CreateConfigurationInput,
): Promise<CreateConfigurationResult> {
	const { organizationId, userId, repoIds, name } = input;

	if (!repoIds || repoIds.length === 0) {
		throw new Error("At least one repo is required");
	}

	// Verify repos exist and belong to organization
	const repos = await configurationsDb.getReposByIds(repoIds);

	if (!repos || repos.length !== repoIds.length) {
		throw new Error("One or more repos not found");
	}

	for (const repo of repos) {
		if (repo.organizationId !== organizationId) {
			throw new Error("Unauthorized access to repo");
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
		throw new Error("Failed to link repos to configuration");
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
 * @throws Error if configuration or repo not found, or unauthorized
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
		if (!config) throw new Error("Configuration not found");
	}

	// Verify repo exists
	const repos = await configurationsDb.getReposByIds([repoId]);
	if (!repos.length) throw new Error("Repo not found");
	if (repos[0].organizationId !== orgId) throw new Error("Unauthorized access to repo");

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
 * @throws Error if configuration not found
 */
export async function detachRepo(
	configurationId: string,
	repoId: string,
	orgId: string,
): Promise<void> {
	const belongs = await configurationBelongsToOrg(configurationId, orgId);
	if (!belongs) throw new Error("Configuration not found");

	await configurationsDb.deleteConfigurationRepo(configurationId, repoId);
}

/**
 * Update a configuration.
 *
 * @throws Error if nothing to update
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
		throw new Error("No fields to update");
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

/**
 * Request a configuration snapshot build (fire-and-forget).
 *
 * Enqueues a background job that boots a sandbox from the base snapshot,
 * clones all configuration repos, and captures a filesystem snapshot.
 * Only works when Modal is configured (MODAL_APP_NAME is set).
 */
export async function requestConfigurationSnapshotBuild(
	configurationId: string,
	options?: { force?: boolean },
): Promise<void> {
	if (!env.MODAL_APP_NAME) {
		// Modal not configured — mark as default without snapshot so config isn't stuck in "building"
		await configurationsDb.markConfigurationDefaultNoSnapshot(configurationId);
		return;
	}

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
		super(
			`Failed to create snapshot: ${cause instanceof Error ? cause.message : "Unknown error"}`,
		);
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
				throw new Error(`Failed to store secret key: ${key}`);
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
