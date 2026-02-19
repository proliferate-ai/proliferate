/**
 * Configuration snapshot build worker.
 *
 * Builds configuration snapshots asynchronously: boots a sandbox from the base
 * snapshot, clones all configuration repos, and captures a filesystem snapshot.
 * New sessions can then start from this snapshot with near-zero latency.
 */

import type { Logger } from "@proliferate/logger";
import { createConfigurationSnapshotBuildWorker } from "@proliferate/queue";
import { configurations } from "@proliferate/services";
import { ModalLibmodalProvider } from "@proliferate/shared/providers";
import type { Worker } from "bullmq";
import { resolveGitHubToken } from "../github-token";

interface ConfigurationSnapshotWorkers {
	buildWorker: Worker;
}

export function startConfigurationSnapshotWorkers(logger: Logger): ConfigurationSnapshotWorkers {
	const buildWorker = createConfigurationSnapshotBuildWorker(async (job) => {
		await handleConfigurationSnapshotBuild(
			job.data.configurationId,
			job.data.force ?? false,
			logger,
		);
	});

	logger.info("Workers started: configuration-snapshots");
	return { buildWorker };
}

export async function stopConfigurationSnapshotWorkers(
	workers: ConfigurationSnapshotWorkers,
): Promise<void> {
	await workers.buildWorker.close();
}

async function handleConfigurationSnapshotBuild(
	configurationId: string,
	force: boolean,
	logger: Logger,
): Promise<void> {
	const log = logger.child({ configurationId, module: "configuration-snapshots" });

	const config = await configurations.getConfigurationSnapshotBuildInfo(configurationId);
	if (!config) {
		log.warn("Configuration not found");
		return;
	}

	if (!force && (config.status === "default" || config.status === "ready") && config.snapshotId) {
		log.info({ snapshotId: config.snapshotId }, "Configuration snapshot already built");
		return;
	}

	const repos = config.configurationRepos.filter((cr) => cr.repo !== null).map((cr) => cr.repo!);

	if (repos.length === 0) {
		const message = "Configuration has no repos";
		await configurations.markConfigurationSnapshotFailed(configurationId, message);
		log.warn(message);
		return;
	}

	await configurations.markConfigurationSnapshotBuilding(configurationId);

	// Resolve tokens and build repo inputs for the provider
	const repoInputs: Array<{
		repoUrl: string;
		token?: string;
		workspacePath: string;
		repoId: string;
	}> = [];

	for (const cr of config.configurationRepos) {
		if (!cr.repo) continue;
		const repo = cr.repo;

		const token = await resolveGitHubToken(repo.organizationId, repo.id);

		if (repo.isPrivate && !token) {
			const message = `Missing GitHub token for private repo ${repo.githubRepoName}`;
			await configurations.markConfigurationSnapshotFailed(configurationId, message);
			log.warn({ repoId: repo.id }, message);
			return;
		}

		repoInputs.push({
			repoUrl: repo.githubUrl,
			token: token || undefined,
			workspacePath: cr.workspacePath,
			repoId: repo.id,
		});
	}

	// Use first repo's default branch (multi-repo configs use individual repo branches via setupSandbox)
	const branch = repos[0].defaultBranch || "main";

	const provider = new ModalLibmodalProvider();
	try {
		const result = await provider.createConfigurationSnapshot({
			configurationId,
			repos: repoInputs,
			branch,
		});

		await configurations.markConfigurationSnapshotDefault(configurationId, result.snapshotId);

		log.info(
			{ snapshotId: result.snapshotId, repoCount: repoInputs.length, branch },
			"Configuration snapshot built",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await configurations.markConfigurationSnapshotFailed(configurationId, message);
		log.error({ err: error }, "Configuration snapshot build failed");
		throw error;
	}
}
