/**
 * Snapshot refresh workers.
 *
 * Two workers:
 * 1. Tick worker — repeatable every 30 minutes, fans out individual refresh jobs.
 * 2. Refresh worker — processes one configuration: boot from snapshot → git pull → install → re-snapshot.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import {
	type Queue,
	type SnapshotRefreshJob,
	createSnapshotRefreshQueue,
	createSnapshotRefreshTickQueue,
	createSnapshotRefreshTickWorker,
	createSnapshotRefreshWorker,
} from "@proliferate/queue";
import { configurations } from "@proliferate/services";
import type { Worker } from "bullmq";
import { Sandbox } from "e2b";
import { resolveGitHubToken } from "../github-token";

interface SnapshotRefreshWorkers {
	tickWorker: Worker;
	refreshWorker: Worker;
	refreshQueue: Queue<SnapshotRefreshJob>;
}

export function startSnapshotRefreshWorkers(logger: Logger): SnapshotRefreshWorkers {
	const refreshQueue = createSnapshotRefreshQueue();

	const tickWorker = createSnapshotRefreshTickWorker(async () => {
		await handleTick(refreshQueue, logger);
	});

	const refreshWorker = createSnapshotRefreshWorker(async (job) => {
		await handleRefresh(job.data.configurationId, logger);
	});

	// Schedule repeatable tick (every 30 minutes)
	void scheduleRefreshTick(logger);

	logger.info("Workers started: snapshot-refresh");
	return { tickWorker, refreshWorker, refreshQueue };
}

export async function stopSnapshotRefreshWorkers(workers: SnapshotRefreshWorkers): Promise<void> {
	await workers.tickWorker.close();
	await workers.refreshWorker.close();
	await workers.refreshQueue.close();
}

async function scheduleRefreshTick(logger: Logger): Promise<void> {
	let tickQueue: Queue | null = null;
	try {
		tickQueue = createSnapshotRefreshTickQueue();
		await tickQueue.add(
			"snapshot-refresh-tick",
			{},
			{
				repeat: { every: 30 * 60 * 1000 },
				jobId: "snapshot-refresh-tick",
			},
		);
	} catch (err) {
		logger.warn({ err }, "Failed to schedule snapshot refresh tick");
	} finally {
		if (tickQueue) await tickQueue.close();
	}
}

/**
 * Tick handler: finds all configurations due for refresh and enqueues individual jobs.
 */
async function handleTick(refreshQueue: Queue<SnapshotRefreshJob>, logger: Logger): Promise<void> {
	const dueConfigs = await configurations.listDueForRefresh();

	if (dueConfigs.length === 0) {
		logger.debug("No configurations due for snapshot refresh");
		return;
	}

	logger.info({ count: dueConfigs.length }, "Fanning out snapshot refresh jobs");

	for (const config of dueConfigs) {
		await refreshQueue.add(
			`refresh-${config.id}`,
			{ configurationId: config.id },
			{ jobId: `refresh-${config.id}` },
		);
	}
}

/**
 * Refresh handler: boots sandbox from snapshot, git pulls, installs deps, re-snapshots.
 */
async function handleRefresh(configurationId: string, logger: Logger): Promise<void> {
	const log = logger.child({ configurationId });

	// Load configuration with repos
	const dueConfigs = await configurations.listDueForRefresh();
	const config = dueConfigs.find((c) => c.id === configurationId);

	if (!config?.snapshotId) {
		log.info("Configuration not due for refresh or has no snapshot, skipping");
		return;
	}

	log.info({ snapshotId: config.snapshotId }, "Starting snapshot refresh");

	// Build E2B API options
	const apiOpts: { apiKey?: string; domain?: string } = {};
	if (env.E2B_API_KEY) apiOpts.apiKey = env.E2B_API_KEY;
	if (env.E2B_DOMAIN) apiOpts.domain = env.E2B_DOMAIN;

	let sandbox: Sandbox | null = null;

	try {
		// 1. Boot sandbox from existing snapshot
		sandbox = await Sandbox.create(config.snapshotId, {
			timeoutMs: 10 * 60 * 1000,
			...apiOpts,
		});
		log.info({ sandboxId: sandbox.sandboxId }, "Sandbox booted from snapshot");

		// 2. Resolve GitHub tokens and set up git credentials
		const repos = config.configurationRepos
			.map((cr) => cr.repo)
			.filter((r): r is NonNullable<typeof r> => r !== null);

		const gitCredentials: Record<string, string> = {};
		for (const repo of repos) {
			const token = await resolveGitHubToken(repo.organizationId, repo.id);
			if (token) {
				const base = repo.githubUrl.replace(/\.git$/, "").replace(/\/$/, "");
				for (const url of [base, `${base}/`, `${base}.git`, `${base}.git/`]) {
					gitCredentials[url] = token;
				}
			}
		}

		await sandbox.files.write("/tmp/.git-credentials.json", JSON.stringify(gitCredentials));

		// 3. Git pull in each workspace
		const workspaceDir = "/home/user/workspace";
		for (const cr of config.configurationRepos) {
			if (!cr.repo) continue;
			const targetDir =
				cr.workspacePath === "." ? workspaceDir : `${workspaceDir}/${cr.workspacePath}`;

			try {
				const result = await sandbox.commands.run(`cd "${targetDir}" && git pull --ff-only 2>&1`, {
					timeoutMs: 120000,
				});
				log.info(
					{ repo: cr.workspacePath, stdout: result.stdout.slice(0, 500) },
					"Git pull complete",
				);
			} catch (err) {
				log.warn({ err, repo: cr.workspacePath }, "Git pull failed");
			}
		}

		// 4. Detect package manager and install deps
		for (const cr of config.configurationRepos) {
			if (!cr.repo) continue;
			const targetDir =
				cr.workspacePath === "." ? workspaceDir : `${workspaceDir}/${cr.workspacePath}`;

			const installCmd = await detectInstallCommand(sandbox, targetDir);
			if (installCmd) {
				try {
					log.info({ repo: cr.workspacePath, command: installCmd }, "Running install");
					await sandbox.commands.run(`cd "${targetDir}" && ${installCmd}`, {
						timeoutMs: 5 * 60 * 1000,
					});
					log.info({ repo: cr.workspacePath }, "Install complete");
				} catch (err) {
					log.warn({ err, repo: cr.workspacePath }, "Install failed (non-fatal)");
				}
			}
		}

		// 5. Take new snapshot
		const result = await Sandbox.createSnapshot(sandbox.sandboxId, apiOpts);
		const newSnapshotId = result.snapshotId;
		log.info({ newSnapshotId }, "New snapshot created");

		// 6. Update configuration with new snapshot
		await configurations.markRefreshed(configurationId, newSnapshotId);
		log.info("Configuration marked as refreshed");
	} catch (err) {
		log.error({ err }, "Snapshot refresh failed");
		throw err;
	} finally {
		if (sandbox) {
			try {
				await sandbox.kill();
			} catch (err) {
				log.warn({ err }, "Failed to terminate refresh sandbox");
			}
		}
	}
}

/**
 * Detect the appropriate install command based on lockfile presence.
 */
async function detectInstallCommand(sandbox: Sandbox, dir: string): Promise<string | null> {
	try {
		const result = await sandbox.commands.run(
			`ls -1 "${dir}/pnpm-lock.yaml" "${dir}/yarn.lock" "${dir}/bun.lockb" "${dir}/package-lock.json" 2>/dev/null || true`,
			{ timeoutMs: 5000 },
		);
		const output = result.stdout;

		if (output.includes("pnpm-lock.yaml")) return "pnpm install --frozen-lockfile";
		if (output.includes("yarn.lock")) return "yarn install --frozen-lockfile";
		if (output.includes("bun.lockb")) return "bun install --frozen-lockfile";
		if (output.includes("package-lock.json")) return "npm ci";
		return null;
	} catch {
		return null;
	}
}
