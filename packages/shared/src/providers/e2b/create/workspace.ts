import type { Logger } from "@proliferate/logger";
import type { Sandbox } from "e2b";
import {
	SANDBOX_PATHS,
	type SessionMetadata,
	buildGitCredentialsMap,
	shellEscape,
} from "../../../sandbox";
import type { CreateSandboxOpts } from "../../types";

/** Finds a repo `.git` directory when metadata is missing on restore. */
const FIND_GIT_DIR_FALLBACK_COMMAND =
	"find /home/user -maxdepth 5 -name '.git' -type d 2>/dev/null | head -1";

/** Last-resort fallback to locate default workspace repo path. */
const FIND_WORKSPACE_REPO_FALLBACK_COMMAND =
	"ls -d /home/user/workspace/*/repo 2>/dev/null | head -1";

/** Builds a branch-targeted shallow clone command. */
function buildCloneCommand(branch: string, cloneUrl: string, targetDir: string): string {
	return `git clone --depth 1 --branch ${shellEscape(branch)} '${cloneUrl}' ${shellEscape(targetDir)}`;
}

/** Builds a default-branch shallow clone fallback command. */
function buildCloneDefaultBranchCommand(cloneUrl: string, targetDir: string): string {
	return `git clone --depth 1 '${cloneUrl}' ${shellEscape(targetDir)}`;
}

/**
 * Ensures workspace state exists for the session and returns the primary repo directory.
 * On snapshot restore it prefers persisted metadata, then best-effort filesystem fallbacks.
 */
export async function setupWorkspace(
	sandbox: Sandbox,
	opts: CreateSandboxOpts,
	isSnapshot: boolean,
	log: Logger,
): Promise<string> {
	const workspaceDir = "/home/user/workspace";

	if (isSnapshot) {
		log.info("Restoring from snapshot - reading metadata (skipping clone)");
		try {
			const metadataStr = await sandbox.files.read(SANDBOX_PATHS.metadataFile);
			const metadata: SessionMetadata = JSON.parse(metadataStr);
			log.info({ repoDir: metadata.repoDir }, "Found repoDir from snapshot metadata");
			return metadata.repoDir;
		} catch (metadataErr) {
			log.warn({ err: metadataErr }, "Snapshot metadata not found, falling back to find command");
			const findResult = await sandbox.commands.run(FIND_GIT_DIR_FALLBACK_COMMAND, {
				timeoutMs: 30000,
			});

			if (findResult.stdout.trim()) {
				const gitDir = findResult.stdout.trim();
				const repoDir = gitDir.replace("/.git", "");
				log.info({ repoDir }, "Found repo via find fallback");
				return repoDir;
			}

			const lsResult = await sandbox.commands.run(FIND_WORKSPACE_REPO_FALLBACK_COMMAND, {
				timeoutMs: 10000,
			});
			const repoDir = lsResult.stdout.trim() || "/home/user";
			log.warn({ repoDir }, "Using last-resort repo fallback (repos likely missing)");
			return repoDir;
		}
	}

	const repos = opts.repos ?? [];
	log.info({ repoCount: repos.length }, "Setting up workspace");
	await sandbox.commands.run(`mkdir -p ${workspaceDir}`, { timeoutMs: 10000 });

	if (repos.length === 0) {
		log.info("Scratch session — no repos to clone");
		const metadata: SessionMetadata = {
			sessionId: opts.sessionId,
			repoDir: workspaceDir,
			createdAt: Date.now(),
		};
		await sandbox.files.write(SANDBOX_PATHS.metadataFile, JSON.stringify(metadata));
		return workspaceDir;
	}

	const gitCredentials = buildGitCredentialsMap(repos);
	if (Object.keys(gitCredentials).length > 0) {
		log.debug({ repoCount: repos.length }, "Writing git credentials");
		await sandbox.commands.run("rm -f /tmp/.git-credentials.json", { timeoutMs: 5000 });
		await sandbox.files.write("/tmp/.git-credentials.json", JSON.stringify(gitCredentials));
	}

	let firstRepoDir: string | null = null;
	for (let i = 0; i < repos.length; i++) {
		const repo = repos[i];
		const targetDir = `${workspaceDir}/${repo.workspacePath}`;
		if (firstRepoDir === null) {
			firstRepoDir = targetDir;
		}

		let cloneUrl = repo.repoUrl;
		if (repo.token) {
			cloneUrl = repo.repoUrl.replace("https://", `https://x-access-token:${repo.token}@`);
		}

		log.info(
			{
				repo: repo.workspacePath,
				repoUrl: repo.repoUrl,
				hasToken: Boolean(repo.token),
				index: i + 1,
				total: repos.length,
				targetDir,
			},
			"Cloning repo",
		);

		const repoBranch = repo.branch ?? opts.branch;
		const cloneResult = await sandbox.commands.run(
			buildCloneCommand(repoBranch, cloneUrl, targetDir),
			{
				timeoutMs: 120000,
			},
		);

		if (cloneResult.exitCode !== 0) {
			log.warn(
				{ repo: repo.workspacePath, exitCode: cloneResult.exitCode, stderr: cloneResult.stderr },
				"Branch clone failed, trying default",
			);
			const fallbackResult = await sandbox.commands.run(
				buildCloneDefaultBranchCommand(cloneUrl, targetDir),
				{
					timeoutMs: 120000,
				},
			);
			if (fallbackResult.exitCode !== 0) {
				log.error(
					{
						repo: repo.workspacePath,
						exitCode: fallbackResult.exitCode,
						stderr: fallbackResult.stderr,
					},
					"Repo clone failed completely",
				);
				throw new Error(`git clone failed for ${repo.repoUrl}: ${fallbackResult.stderr}`);
			}
			log.info({ repo: repo.workspacePath }, "Repo cloned successfully (default branch)");
		} else {
			log.info({ repo: repo.workspacePath }, "Repo cloned successfully");
		}
	}

	const repoDir = repos.length > 1 ? workspaceDir : firstRepoDir || workspaceDir;
	log.info({ repoDir, repoCount: repos.length }, "All repositories cloned");

	const metadata: SessionMetadata = {
		sessionId: opts.sessionId,
		repoDir,
		createdAt: Date.now(),
	};
	await sandbox.files.write(SANDBOX_PATHS.metadataFile, JSON.stringify(metadata, null, 2));
	log.debug("Session metadata saved");

	return repoDir;
}
