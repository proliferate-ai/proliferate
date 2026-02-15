/**
 * Configurations service.
 *
 * Business logic that orchestrates DB operations.
 */

import { randomUUID } from "crypto";
import { env } from "@proliferate/environment/server";
import type { ServiceCommand } from "@proliferate/shared";
import { parseServiceCommands } from "@proliferate/shared/sandbox";
import * as configurationsDb from "./db";
import type { Configuration } from "./mapper";
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
	description?: string;
}

export interface EffectiveServiceCommandsResult {
	source: "configuration" | "none";
	commands: ServiceCommand[];
	workspaces: string[];
}

// ============================================
// Service functions
// ============================================

/**
 * List configurations for an organization.
 * Filters to only include configurations with repos in the given org.
 */
export async function listConfigurations(orgId: string): Promise<Configuration[]> {
	const rows = await configurationsDb.listAll();

	// Filter to only configurations that have repos in this org
	const filteredRows = rows.filter((p) =>
		p.configurationRepos?.some((cr) => cr.repo?.organizationId === orgId),
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
	const { organizationId, repoIds, name } = input;

	if (!repoIds || repoIds.length === 0) {
		throw new Error("repoIds[] is required");
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

	// Create configuration record
	const configurationId = randomUUID();
	await configurationsDb.create({
		id: configurationId,
		organizationId,
		name,
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
 * Update a configuration.
 *
 * @throws Error if nothing to update
 */
export async function updateConfiguration(
	id: string,
	input: UpdateConfigurationInput,
): Promise<Partial<Configuration>> {
	if (input.name === undefined && input.description === undefined) {
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
	return configuration.configurationRepos.some((cr) => cr.repo?.organizationId === orgId);
}

/**
 * Get the effective service commands for a configuration.
 * Reads from configuration-level service commands only (repo-level merge removed).
 */
export async function getEffectiveServiceCommands(
	configurationId: string,
): Promise<EffectiveServiceCommandsResult> {
	const [configurationRow, repoRows] = await Promise.all([
		configurationsDb.getConfigurationServiceCommands(configurationId),
		configurationsDb.getConfigurationReposWithDetails(configurationId),
	]);

	const commands = parseServiceCommands(configurationRow?.serviceCommands);
	const source: EffectiveServiceCommandsResult["source"] =
		commands.length > 0 ? "configuration" : "none";

	const workspaces = [...new Set(repoRows.map((r) => r.workspacePath))];

	return { source, commands, workspaces };
}
