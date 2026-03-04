import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import type { Sandbox } from "e2b";
import {
	SANDBOX_PATHS,
	type SessionMetadata,
	buildGitCredentialsMap,
	capOutput,
	shellEscape,
	shouldPullOnRestore,
} from "../../../sandbox";
import type { CreateSandboxOpts } from "../../types";

/**
 * Optionally runs `git pull --ff-only` on restored snapshots based on cadence policy.
 * This is best-effort and never blocks sandbox startup on pull failures.
 */
export async function pullOnRestore(
	sandbox: Sandbox,
	opts: CreateSandboxOpts,
	log: Logger,
): Promise<void> {
	let metadata: SessionMetadata | null = null;
	try {
		const raw = await sandbox.files.read(SANDBOX_PATHS.metadataFile);
		metadata = JSON.parse(raw) as SessionMetadata;
	} catch {
		// No metadata -> legacy snapshot or fresh sandbox
	}

	// TODO: Consider always pulling on restore instead of cadence-gating.
	// The cadence logic adds complexity to avoid redundant pulls on rapid pause/resume,
	// but with E2B's native pause the resume path is fast enough that always pulling
	// (and doing it async/non-blocking) may be simpler and more predictable.
	const doPull = shouldPullOnRestore({
		enabled: env.SANDBOX_GIT_PULL_ON_RESTORE,
		hasSnapshot: Boolean(opts.snapshotId),
		repoCount: opts.repos.length,
		cadenceSeconds: env.SANDBOX_GIT_PULL_CADENCE_SECONDS,
		lastGitFetchAt: metadata?.lastGitFetchAt,
	});

	const gitCredentials = buildGitCredentialsMap(opts.repos);
	await sandbox.commands.run("rm -f /tmp/.git-credentials.json", { timeoutMs: 5000 });
	await sandbox.files.write("/tmp/.git-credentials.json", JSON.stringify(gitCredentials));

	if (!doPull) return;

	const workspaceDir = `${SANDBOX_PATHS.home}/workspace`;
	let allPullsSucceeded = true;

	for (const repo of opts.repos) {
		const targetDir =
			repo.workspacePath === "." ? workspaceDir : `${workspaceDir}/${repo.workspacePath}`;
		const pullStartMs = Date.now();
		try {
			const result = await sandbox.commands.run(
				`cd ${shellEscape(targetDir)} && git pull --ff-only 2>&1`,
				{ timeoutMs: 60000 },
			);
			log.info(
				{
					repo: repo.workspacePath,
					durationMs: Date.now() - pullStartMs,
					output: capOutput(result.stdout),
				},
				"Git freshness pull complete",
			);
		} catch (err) {
			allPullsSucceeded = false;
			log.warn(
				{ err, repo: repo.workspacePath, durationMs: Date.now() - pullStartMs },
				"Git freshness pull failed (non-fatal)",
			);
		}
	}

	if (allPullsSucceeded && metadata) {
		try {
			const updated: SessionMetadata = { ...metadata, lastGitFetchAt: Date.now() };
			await sandbox.files.write(SANDBOX_PATHS.metadataFile, JSON.stringify(updated, null, 2));
		} catch {
			// Non-fatal
		}
	}
}
