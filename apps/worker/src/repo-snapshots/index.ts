/**
 * Repo snapshot build worker.
 *
 * Builds deterministic repo snapshots asynchronously so new sessions can start with near-zero latency.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { createRepoSnapshotBuildWorker } from "@proliferate/queue";
import { integrations, repos } from "@proliferate/services";
import { ModalLibmodalProvider } from "@proliferate/shared/providers";
import type { Worker } from "bullmq";

interface RepoSnapshotWorkers {
	buildWorker: Worker;
}

export function startRepoSnapshotWorkers(logger: Logger): RepoSnapshotWorkers {
	const buildWorker = createRepoSnapshotBuildWorker(async (job) => {
		await handleRepoSnapshotBuild(job.data.repoId, job.data.force ?? false, logger);
	});

	logger.info("Workers started: repo-snapshots");
	return { buildWorker };
}

export async function stopRepoSnapshotWorkers(workers: RepoSnapshotWorkers): Promise<void> {
	await workers.buildWorker.close();
}

async function handleRepoSnapshotBuild(
	repoId: string,
	force: boolean,
	logger: Logger,
): Promise<void> {
	const log = logger.child({ repoId, module: "repo-snapshots" });

	const repo = await repos.getRepoSnapshotBuildInfo(repoId);
	if (!repo) {
		log.warn("Repo not found");
		return;
	}

	if (repo.source !== "github" || !repo.githubUrl) {
		log.info(
			{ source: repo.source, hasUrl: Boolean(repo.githubUrl) },
			"Skipping repo snapshot build",
		);
		return;
	}

	if (!force && repo.repoSnapshotStatus === "ready" && repo.repoSnapshotId) {
		log.info({ snapshotId: repo.repoSnapshotId }, "Repo snapshot already ready");
		return;
	}

	await repos.markRepoSnapshotBuilding(repoId);

	const branch = repo.defaultBranch || "main";
	const token = await resolveGitHubToken(repo.organizationId, repoId);

	if (repo.isPrivate && !token) {
		const message = "Missing GitHub token for private repo snapshot build";
		await repos.markRepoSnapshotFailed({ repoId, error: message });
		log.warn({ branch }, message);
		return;
	}

	const provider = new ModalLibmodalProvider();
	try {
		const result = await provider.createRepoSnapshot({
			repoId,
			repoUrl: repo.githubUrl,
			token,
			branch,
		});

		await repos.markRepoSnapshotReady({
			repoId,
			snapshotId: result.snapshotId,
			commitSha: result.commitSha,
		});

		log.info(
			{ snapshotId: result.snapshotId, commitSha: result.commitSha, branch },
			"Repo snapshot built",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await repos.markRepoSnapshotFailed({ repoId, error: message });
		log.error({ err: error }, "Repo snapshot build failed");
		throw error;
	}
}

async function resolveGitHubToken(orgId: string, repoId: string): Promise<string> {
	// 1) Prefer repo-linked connections.
	const repoConnections = await integrations.getRepoConnectionsWithIntegrations(repoId);
	const activeIntegrations = repoConnections
		.map((rc) => rc.integration)
		.filter((i): i is NonNullable<typeof i> => Boolean(i))
		.filter((i) => i.status === "active");

	const preferred =
		activeIntegrations.find((i) => Boolean(i.githubInstallationId)) ??
		activeIntegrations[0] ??
		null;

	if (preferred?.githubInstallationId) {
		return integrations.getInstallationToken(preferred.githubInstallationId);
	}

	if (preferred?.connectionId) {
		const nangoIntegrationId = env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID;
		if (!nangoIntegrationId) return "";

		return integrations.getToken({
			id: preferred.id,
			provider: "nango",
			integrationId: nangoIntegrationId,
			connectionId: preferred.connectionId,
			githubInstallationId: null,
		});
	}

	// 2) Fall back to org-wide GitHub integration.
	const githubAppIntegration = await integrations.findActiveGitHubApp(orgId);
	if (githubAppIntegration?.githubInstallationId) {
		return integrations.getInstallationToken(githubAppIntegration.githubInstallationId);
	}

	const nangoIntegrationId = env.NEXT_PUBLIC_NANGO_GITHUB_INTEGRATION_ID;
	if (!nangoIntegrationId) return "";

	const nangoIntegration = await integrations.findActiveNangoGitHub(orgId, nangoIntegrationId);
	if (nangoIntegration?.connectionId) {
		return integrations.getToken({
			id: nangoIntegration.id,
			provider: "nango",
			integrationId: nangoIntegrationId,
			connectionId: nangoIntegration.connectionId,
			githubInstallationId: null,
		});
	}

	return "";
}
