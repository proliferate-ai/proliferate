/**
 * File Syncer
 *
 * Unified file synchronization to remote sandbox via rsync.
 * Supports percentage-based progress updates.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSSHKeyInfo } from "./ssh.ts";

// SSH options for all connections
const SSH_OPTIONS = [
	"-o",
	"StrictHostKeyChecking=no",
	"-o",
	"UserKnownHostsFile=/dev/null",
	"-o",
	"IdentitiesOnly=yes",
	"-o",
	"ConnectTimeout=10",
];

export interface SyncJob {
	/** Local path (supports ~ for home directory) */
	local: string;
	/** Remote path on sandbox */
	remote: string;
	/** Remove files not in source (default: false) */
	delete?: boolean;
	/** Patterns to exclude */
	excludes?: string[];
	/** Respect .gitignore in source directory (default: false) */
	respectGitignore?: boolean;
}

export interface Progress {
	/** Current job index (1-based) */
	job: number;
	/** Total number of jobs */
	totalJobs: number;
	/** Overall progress percentage (0-100) */
	percent: number;
	/** Human readable status message */
	message: string;
}

export type ProgressCallback = (progress: Progress) => void;

interface SpawnResult {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Promise wrapper for spawn with optional output streaming
 */
function spawnAsync(
	command: string,
	args: string[],
	onOutput?: (data: string) => void,
): Promise<SpawnResult> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, { stdio: "pipe" });

		let stdout = "";
		let stderr = "";

		proc.stdout?.on("data", (data) => {
			const str = data.toString();
			stdout += str;
			onOutput?.(str);
		});

		proc.stderr?.on("data", (data) => {
			const str = data.toString();
			stderr += str;
			onOutput?.(str);
		});

		proc.on("close", (code) => {
			resolve({ code: code ?? 0, stdout, stderr });
		});

		proc.on("error", () => {
			resolve({ code: 1, stdout, stderr });
		});
	});
}

/**
 * Parse rsync --info=progress2 output to extract percentage
 * Example output: "  1,234,567  50%   10.00MB/s    0:00:05"
 */
function parseRsyncProgress(line: string): number | null {
	const match = line.match(/(\d+)%/);
	if (match) {
		return Number.parseInt(match[1], 10);
	}
	return null;
}

/**
 * File syncer for transferring files to remote sandbox
 */
export class FileSyncer {
	private host: string;
	private port: number;
	private keyPath: string;

	constructor(options: { host: string; port: number }) {
		this.host = options.host;
		this.port = options.port;
		this.keyPath = getSSHKeyInfo().privateKeyPath;
	}

	/**
	 * Sync multiple jobs to remote
	 */
	async sync(jobs: SyncJob[], onProgress?: ProgressCallback): Promise<void> {
		const validJobs = jobs.filter((job) => {
			const localPath = expandPath(job.local);
			return existsSync(localPath);
		});

		if (validJobs.length === 0) {
			onProgress?.({ job: 0, totalJobs: 0, percent: 100, message: "Nothing to sync" });
			return;
		}

		for (let i = 0; i < validJobs.length; i++) {
			const job = validJobs[i];
			const jobNum = i + 1;
			const localPath = expandPath(job.local);
			const jobName = job.local.startsWith("~/")
				? job.local
				: localPath.split("/").pop() || "files";

			onProgress?.({
				job: jobNum,
				totalJobs: validJobs.length,
				percent: Math.round((i / validJobs.length) * 100),
				message: `Syncing ${jobName}...`,
			});

			await this.rsyncJob(job, localPath, (jobPercent) => {
				const overallPercent = Math.round((i * 100 + jobPercent) / validJobs.length);
				onProgress?.({
					job: jobNum,
					totalJobs: validJobs.length,
					percent: overallPercent,
					message: `Syncing ${jobName}...`,
				});
			});
		}

		// Fix ownership once at the end
		await this.fixOwnership("/home/user");

		onProgress?.({
			job: validJobs.length,
			totalJobs: validJobs.length,
			percent: 100,
			message: "Sync complete",
		});
	}

	/**
	 * Execute a single rsync job
	 */
	private async rsyncJob(
		job: SyncJob,
		localPath: string,
		onJobProgress?: (percent: number) => void,
	): Promise<void> {
		const isDir = statSync(localPath).isDirectory();

		// Create parent directory on remote for files
		if (!isDir) {
			const parentDir = job.remote.substring(0, job.remote.lastIndexOf("/"));
			await this.sshExec(`mkdir -p "${parentDir}"`);
		}

		const sshCmd = `ssh ${SSH_OPTIONS.join(" ")} -i ${this.keyPath} -p ${this.port}`;

		const rsyncArgs = ["-az", "--info=progress2", "--no-inc-recursive", "-e", sshCmd];

		if (job.delete) {
			rsyncArgs.push("--delete");
		}

		for (const pattern of job.excludes || []) {
			rsyncArgs.push("--exclude", pattern);
		}

		if (job.respectGitignore && existsSync(join(localPath, ".gitignore"))) {
			rsyncArgs.push("--filter=:- .gitignore");
		}

		rsyncArgs.push(
			isDir ? `${localPath}/` : localPath,
			isDir ? `root@${this.host}:${job.remote}/` : `root@${this.host}:${job.remote}`,
		);

		const result = await spawnAsync("rsync", rsyncArgs, (data) => {
			const percent = parseRsyncProgress(data);
			if (percent !== null) {
				onJobProgress?.(percent);
			}
		});

		if (result.code !== 0) {
			throw new Error(`rsync failed: ${result.stderr}`);
		}
	}

	/**
	 * Run command on remote via SSH
	 */
	private async sshExec(command: string): Promise<SpawnResult> {
		return spawnAsync("ssh", [
			...SSH_OPTIONS,
			"-i",
			this.keyPath,
			"-p",
			this.port.toString(),
			`root@${this.host}`,
			command,
		]);
	}

	/**
	 * Fix ownership of synced files (rsync runs as root)
	 */
	private async fixOwnership(remotePath: string): Promise<void> {
		await this.sshExec(`chown -R user:user "${remotePath}"`);
	}
}

/**
 * Default config files to sync from local machine
 */
export const CONFIG_SYNC_JOBS: SyncJob[] = [
	// Git and SSH
];
