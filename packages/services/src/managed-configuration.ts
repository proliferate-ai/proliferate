/**
 * Managed Configuration Utility
 *
 * Managed configurations are auto-created/maintained by universal clients (Slack, CLI, etc.)
 * They contain all repos for an organization in a single configuration.
 *
 * Usage:
 *   const syncClient = createSyncClient({ baseUrl, auth: { type: "service", name: "my-service", secret } });
 *   const configuration = await getOrCreateManagedConfiguration({ organizationId, gateway: syncClient });
 */

import type { SyncClient } from "@proliferate/gateway-clients";
import * as configurationsDb from "./configurations/db";
import { getServicesLogger } from "./logger";
import * as sessionsDb from "./sessions/db";

export interface ManagedConfiguration {
	id: string;
	repoIds: string[];
	isNew: boolean; // true if just created
}

export interface GetOrCreateManagedConfigurationOptions {
	organizationId: string;
	gateway: SyncClient;
	repoIds?: string[]; // Optional: specific repo IDs to include. If not provided, uses all org repos.
}

/**
 * Get or create a managed configuration for an organization.
 *
 * - If one exists, returns it (even if still building - caller can use immediately)
 * - If none exists, creates one and kicks off setup automatically
 *
 * The caller can always use the returned configuration immediately. The gateway
 * will create the sandbox and take an early snapshot automatically.
 */
export async function getOrCreateManagedConfiguration(
	options: GetOrCreateManagedConfigurationOptions,
): Promise<ManagedConfiguration> {
	const { organizationId, gateway, repoIds: specificRepoIds } = options;

	// 1. Check for existing managed configuration (only if not creating with specific repos)
	if (!specificRepoIds) {
		const existing = await findManagedConfiguration(organizationId);
		if (existing) {
			return { ...existing, isNew: false };
		}
	}

	// 2. No managed configuration - create one
	const { configurationId, repoIds, repoNames } = await createManagedConfigurationRecord(
		organizationId,
		specificRepoIds,
	);

	// 3. Create setup session and kick it off
	await createAndStartSetupSession(configurationId, organizationId, repoNames, gateway);

	return {
		id: configurationId,
		repoIds,
		isNew: true,
	};
}

/**
 * Find existing managed configuration for an org
 */
async function findManagedConfiguration(
	organizationId: string,
): Promise<Omit<ManagedConfiguration, "isNew"> | null> {
	const configurations = await configurationsDb.findManagedConfigurations();

	// Filter to configurations that have repos in this org
	const orgConfigurations = configurations.filter((c) =>
		c.configurationRepos?.some((cr) => cr.repo?.organizationId === organizationId),
	);

	if (orgConfigurations.length === 0) {
		return null;
	}

	// Return the most recent one
	const best = orgConfigurations[0];
	const repoIds =
		best.configurationRepos?.map((cr) => cr.repo?.id).filter((id): id is string => !!id) || [];

	return {
		id: best.id,
		repoIds,
	};
}

/**
 * Create the managed configuration record in the database
 */
async function createManagedConfigurationRecord(
	organizationId: string,
	specificRepoIds?: string[],
): Promise<{ configurationId: string; repoIds: string[]; repoNames: string[] }> {
	const repos = await configurationsDb.getReposForManagedConfiguration(
		organizationId,
		specificRepoIds,
	);

	if (repos.length === 0) {
		throw new Error("No repos found for organization");
	}

	// Create configuration record
	const configurationId = crypto.randomUUID();
	await configurationsDb.createManagedConfiguration({ id: configurationId, organizationId });

	// Create configuration_repos entries
	const configurationRepos = repos.map((repo) => {
		const repoName = repo.githubRepoName?.split("/").pop() || repo.id;
		return {
			configurationId,
			repoId: repo.id,
			workspacePath: repos.length === 1 ? "." : repoName,
		};
	});

	try {
		await configurationsDb.createConfigurationRepos(configurationRepos);
	} catch (error) {
		// Clean up on failure
		await configurationsDb.deleteConfiguration(configurationId);
		throw new Error(
			`Failed to link repos: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return {
		configurationId,
		repoIds: repos.map((r) => r.id),
		repoNames: repos.map((r) => r.githubRepoName),
	};
}

/**
 * Create a setup session and post initial prompt to gateway to start it
 */
async function createAndStartSetupSession(
	configurationId: string,
	organizationId: string,
	repoNames: string[],
	gateway: SyncClient,
): Promise<string> {
	const sessionId = crypto.randomUUID();
	const repoNamesStr = repoNames.join(", ") || "workspace";
	const prompt = `Set up ${repoNamesStr} for development. Get everything running and working.`;

	await sessionsDb.createSetupSession({
		id: sessionId,
		configurationId,
		organizationId,
		initialPrompt: prompt,
	});

	// Post initial prompt to gateway to kick off setup (fire-and-forget)
	gateway
		.postMessage(sessionId, {
			content: prompt,
			userId: "managed-configuration-setup",
		})
		.catch((err: Error) => {
			getServicesLogger()
				.child({ module: "managed-configuration", configurationId, sessionId })
				.error({ err }, "Failed to start setup session");
		});

	return sessionId;
}
