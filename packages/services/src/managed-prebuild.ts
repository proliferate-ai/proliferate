/**
 * Managed Prebuild Utility
 *
 * Managed prebuilds are auto-created/maintained by universal clients (Slack, CLI, etc.)
 * They contain all repos for an organization in a single prebuild.
 *
 * Usage:
 *   const syncClient = createSyncClient({ baseUrl, auth: { type: "service", name: "my-service", secret } });
 *   const prebuild = await getOrCreateManagedPrebuild({ organizationId, gateway: syncClient });
 */

import type { SyncClient } from "@proliferate/gateway-clients";
import { getServicesLogger } from "./logger";
import * as prebuildsDb from "./prebuilds/db";
import * as sessionsDb from "./sessions/db";

export interface ManagedPrebuild {
	id: string;
	snapshotId: string | null; // null if still initializing (first use)
	repoIds: string[];
	isNew: boolean; // true if just created
}

export interface GetOrCreateManagedPrebuildOptions {
	organizationId: string;
	gateway: SyncClient;
	repoIds?: string[]; // Optional: specific repo IDs to include. If not provided, uses all org repos.
}

/**
 * Get or create a managed prebuild for an organization.
 *
 * - If one exists, returns it (even if still building - caller can use immediately)
 * - If none exists, creates one and kicks off setup automatically
 *
 * The caller can always use the returned prebuild immediately. The gateway
 * will create the sandbox and take an early snapshot automatically.
 */
export async function getOrCreateManagedPrebuild(
	options: GetOrCreateManagedPrebuildOptions,
): Promise<ManagedPrebuild> {
	const { organizationId, gateway, repoIds: specificRepoIds } = options;

	// 1. Check for existing managed prebuild (only if not creating with specific repos)
	if (!specificRepoIds) {
		const existing = await findManagedPrebuild(organizationId);
		if (existing) {
			return { ...existing, isNew: false };
		}
	}

	// 2. No managed prebuild - create one
	const { prebuildId, repoIds, repoNames } = await createManagedPrebuildRecord(
		organizationId,
		specificRepoIds,
	);

	// 3. Create setup session and kick it off
	await createAndStartSetupSession(prebuildId, organizationId, repoNames, gateway);

	return {
		id: prebuildId,
		snapshotId: null, // Will be set by early snapshot
		repoIds,
		isNew: true,
	};
}

/**
 * Find existing managed prebuild for an org
 */
async function findManagedPrebuild(
	organizationId: string,
): Promise<Omit<ManagedPrebuild, "isNew"> | null> {
	const prebuilds = await prebuildsDb.findManagedPrebuilds();

	// Filter to prebuilds that have repos in this org
	const orgPrebuilds = prebuilds.filter((p) =>
		p.prebuildRepos?.some((pr) => pr.repo?.organizationId === organizationId),
	);

	if (orgPrebuilds.length === 0) {
		return null;
	}

	// Return the most recent one (prefer one with snapshot, but return any)
	const best = orgPrebuilds.find((p) => p.snapshotId) || orgPrebuilds[0];
	const repoIds =
		best.prebuildRepos?.map((pr) => pr.repo?.id).filter((id): id is string => !!id) || [];

	return {
		id: best.id,
		snapshotId: best.snapshotId,
		repoIds,
	};
}

/**
 * Create the managed prebuild record in the database
 */
async function createManagedPrebuildRecord(
	organizationId: string,
	specificRepoIds?: string[],
): Promise<{ prebuildId: string; repoIds: string[]; repoNames: string[] }> {
	const repos = await prebuildsDb.getReposForManagedPrebuild(organizationId, specificRepoIds);

	if (repos.length === 0) {
		throw new Error("No repos found for organization");
	}

	// Create prebuild record
	const prebuildId = crypto.randomUUID();
	await prebuildsDb.createManagedPrebuild({ id: prebuildId, organizationId });

	// Create prebuild_repos entries
	const prebuildRepos = repos.map((repo) => {
		const repoName = repo.githubRepoName?.split("/").pop() || repo.id;
		return {
			prebuildId,
			repoId: repo.id,
			workspacePath: repos.length === 1 ? "." : repoName,
		};
	});

	try {
		await prebuildsDb.createPrebuildRepos(prebuildRepos);
	} catch (error) {
		// Clean up on failure
		await prebuildsDb.deletePrebuild(prebuildId);
		throw new Error(
			`Failed to link repos: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return {
		prebuildId,
		repoIds: repos.map((r) => r.id),
		repoNames: repos.map((r) => r.githubRepoName),
	};
}

/**
 * Create a setup session and post initial prompt to gateway to start it
 */
async function createAndStartSetupSession(
	prebuildId: string,
	organizationId: string,
	repoNames: string[],
	gateway: SyncClient,
): Promise<string> {
	const sessionId = crypto.randomUUID();
	const repoNamesStr = repoNames.join(", ") || "workspace";
	const prompt = `Set up ${repoNamesStr} for development. Get everything running and working.`;

	await sessionsDb.createSetupSession({
		id: sessionId,
		prebuildId,
		organizationId,
		initialPrompt: prompt,
	});

	// Post initial prompt to gateway to kick off setup (fire-and-forget)
	gateway
		.postMessage(sessionId, {
			content: prompt,
			userId: "managed-prebuild-setup",
		})
		.catch((err: Error) => {
			getServicesLogger()
				.child({ module: "managed-prebuild", prebuildId, sessionId })
				.error({ err }, "Failed to start setup session");
		});

	return sessionId;
}
