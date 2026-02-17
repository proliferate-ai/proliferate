/**
 * Configurations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import type { Configuration, ConfigurationServiceCommand } from "@proliferate/shared";
import {
	parseConfigurationServiceCommands,
	parseServiceCommands,
	resolveServiceCommands,
} from "@proliferate/shared/sandbox";
import * as configurationsDb from "./db";
import { toConfiguration, toConfigurationPartial, toConfigurations } from "./mapper";

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
	if (input.name === undefined && input.notes === undefined) {
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
