import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { decodeRepoId, isPathInsideWorkspace } from "../../domain/git/repo-path.js";
import { parsePorcelainStatus } from "../../domain/git/status-parser.js";
import { sandboxEnv } from "../../env.js";

const execFileAsync = promisify(execFile);
const MAX_DIFF_BYTES = 64 * 1024;

export async function listRepos(): Promise<Array<{ id: string; path: string }>> {
	const { stdout } = await execFileAsync(
		"find",
		[sandboxEnv.workspaceDir, "-maxdepth", "3", "-name", ".git", "-type", "d"],
		{ timeout: 5000 },
	);
	return stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((gitDir) => {
			const repoPath = path.dirname(gitDir);
			if (!isPathInsideWorkspace(sandboxEnv.workspaceDir, repoPath)) {
				return null;
			}
			return { id: Buffer.from(repoPath).toString("base64"), path: repoPath };
		})
		.filter((entry): entry is { id: string; path: string } => Boolean(entry));
}

export function resolveRepoPath(repoId: string): string | null {
	return decodeRepoId(sandboxEnv.workspaceDir, repoId);
}

export function validateFilePathInRepo(repoPath: string, filePath: string): boolean {
	const resolved = path.resolve(repoPath, filePath);
	try {
		const realResolved = realpathSync(resolved);
		const realRepo = realpathSync(repoPath);
		return realResolved.startsWith(`${realRepo}/`);
	} catch {
		return resolved.startsWith(`${repoPath}/`);
	}
}

export async function getRepoStatus(repoPath: string) {
	const { stdout } = await execFileAsync(
		"git",
		["-C", repoPath, "status", "--porcelain=v2", "--branch"],
		{ timeout: 10000 },
	);
	return parsePorcelainStatus(stdout);
}

export async function getRepoDiff(repoPath: string, filePath?: string): Promise<string> {
	let stdout = "";
	try {
		const args = ["-C", repoPath, "diff", "HEAD"];
		if (filePath) args.push("--", filePath);
		({ stdout } = await execFileAsync("git", args, {
			timeout: 10000,
			maxBuffer: MAX_DIFF_BYTES * 2,
		}));
	} catch {
		const args = ["-C", repoPath, "diff"];
		if (filePath) args.push("--", filePath);
		({ stdout } = await execFileAsync("git", args, {
			timeout: 10000,
			maxBuffer: MAX_DIFF_BYTES * 2,
		}));
	}

	if (stdout.length > MAX_DIFF_BYTES) {
		return `${stdout.slice(0, MAX_DIFF_BYTES)}\n...[truncated]`;
	}
	return stdout;
}
