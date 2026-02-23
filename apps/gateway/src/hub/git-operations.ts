/**
 * Git Operations
 *
 * Stateless helper that translates high-level git actions into
 * sandbox `execCommand` calls. All output parsing lives here.
 */

import path from "path";
import type { Logger } from "@proliferate/logger";
import type {
	GitCommitSummary,
	GitFileChange,
	GitResultCode,
	GitState,
	RepoSpec,
	SandboxProvider,
} from "@proliferate/shared";
import { SANDBOX_PATHS, buildGitCredentialsMap, shellEscape } from "@proliferate/shared/sandbox";
import type { GitIdentity } from "../lib/git-identity";

const WORKSPACE_DIR = `${SANDBOX_PATHS.home}/workspace`;

/** Non-interactive env for all git/gh commands. */
const GIT_BASE_ENV: Record<string, string> = {
	GIT_TERMINAL_PROMPT: "0",
	GH_PAGER: "cat",
	LC_ALL: "C",
};

/** Read-only ops add GIT_OPTIONAL_LOCKS to avoid contention with agent's index lock. */
const GIT_READONLY_ENV: Record<string, string> = {
	...GIT_BASE_ENV,
	GIT_OPTIONAL_LOCKS: "0",
};

type GitActionResult = {
	success: boolean;
	code: GitResultCode;
	message: string;
	prUrl?: string;
};

export class GitOperations {
	constructor(
		private provider: SandboxProvider,
		private sandboxId: string,
		private gitIdentity: GitIdentity | null = null,
		private repos: RepoSpec[] = [],
		private logger?: Logger,
	) {}

	private resolveGitDir(workspacePath?: string): string {
		if (!workspacePath || workspacePath === "." || workspacePath === "") return WORKSPACE_DIR;
		const resolved = path.resolve(WORKSPACE_DIR, workspacePath);
		if (!resolved.startsWith(`${WORKSPACE_DIR}/`) && resolved !== WORKSPACE_DIR) {
			throw new Error("Invalid workspace path");
		}
		return resolved;
	}

	private async exec(
		argv: string[],
		opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		if (!this.provider.execCommand) {
			throw new Error("Provider does not support execCommand");
		}
		return this.provider.execCommand(this.sandboxId, argv, opts);
	}

	private getGitIdentityEnv(): Record<string, string> {
		if (!this.gitIdentity) {
			return {};
		}
		return {
			GIT_AUTHOR_NAME: this.gitIdentity.name,
			GIT_AUTHOR_EMAIL: this.gitIdentity.email,
			GIT_COMMITTER_NAME: this.gitIdentity.name,
			GIT_COMMITTER_EMAIL: this.gitIdentity.email,
		};
	}

	private getMutableEnv(): Record<string, string> {
		return {
			...GIT_BASE_ENV,
			...this.getGitIdentityEnv(),
		};
	}

	private getReadOnlyEnv(): Record<string, string> {
		return {
			...GIT_READONLY_ENV,
			...this.getGitIdentityEnv(),
		};
	}

	private getWorkspaceToken(workspacePath?: string): string | null {
		if (this.repos.length === 0) {
			return null;
		}

		if (workspacePath && workspacePath !== "." && workspacePath !== "") {
			const exact = this.repos.find((repo) => repo.workspacePath === workspacePath);
			if (exact?.token) {
				return exact.token;
			}
		}

		if (this.repos.length === 1 && this.repos[0]?.token) {
			return this.repos[0].token;
		}

		const rootRepo = this.repos.find((repo) => repo.workspacePath === "." && repo.token);
		if (rootRepo?.token) {
			return rootRepo.token;
		}

		return this.repos.find((repo) => Boolean(repo.token))?.token || null;
	}

	private getAuthEnv(workspacePath?: string): Record<string, string> {
		const token = this.getWorkspaceToken(workspacePath);
		if (!token) {
			return {};
		}
		return {
			GIT_TOKEN: token,
			GH_TOKEN: token,
			GIT_USERNAME: "x-access-token",
		};
	}

	private async refreshGitCredentialsFile(): Promise<void> {
		const credentials = buildGitCredentialsMap(this.repos);
		const encoded = Buffer.from(JSON.stringify(credentials)).toString("base64");
		await this.exec(
			[
				"sh",
				"-c",
				`umask 077 && echo ${shellEscape(encoded)} | base64 -d > /tmp/.git-credentials.json`,
			],
			{ timeoutMs: 10_000, env: this.getMutableEnv() },
		);
	}

	// ============================================
	// Status
	// ============================================

	async getStatus(workspacePath?: string): Promise<GitState> {
		const cwd = this.resolveGitDir(workspacePath);

		// Run all 3 commands in parallel
		const [statusResult, logResult, probeResult] = await Promise.all([
			this.exec(["git", "status", "--porcelain=v2", "--branch", "-z"], {
				cwd,
				timeoutMs: 10_000,
				env: this.getReadOnlyEnv(),
			}),
			this.exec(["git", "log", "--format=%x1e%H%x1f%s%x1f%an%x1f%aI", "-n", "20"], {
				cwd,
				timeoutMs: 10_000,
				env: this.getReadOnlyEnv(),
			}),
			this.exec(
				[
					"sh",
					"-c",
					'echo "shallow:$(git rev-parse --is-shallow-repository)";' +
						'LOCKPATH=$(git rev-parse --git-path index.lock); echo "lock:$(test -f "$LOCKPATH" && echo 1 || echo 0)";' +
						'echo "rebase:$(git rev-parse -q --verify REBASE_HEAD >/dev/null 2>&1 && echo 1 || echo 0)";' +
						'echo "merge:$(git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && echo 1 || echo 0)"',
				],
				{ cwd, timeoutMs: 10_000, env: this.getReadOnlyEnv() },
			),
		]);

		// If git status fails entirely (e.g., not a repo), return NOT_A_REPO state
		if (statusResult.exitCode === 128) {
			return {
				branch: "",
				detached: false,
				stagedChanges: [],
				unstagedChanges: [],
				untrackedFiles: [],
				conflictedFiles: [],
				commits: [],
				ahead: null,
				behind: null,
				isShallow: false,
				isBusy: false,
				rebaseInProgress: false,
				mergeInProgress: false,
			};
		}

		const statusParsed = parseStatusV2(statusResult.stdout);
		const commits = parseLogOutput(logResult.stdout);
		const busyState = parseBusyState(probeResult.stdout);

		return {
			...statusParsed,
			// Shallow clones have incomplete tracking info — report unknown
			ahead: busyState.isShallow ? null : statusParsed.ahead,
			behind: busyState.isShallow ? null : statusParsed.behind,
			commits,
			isShallow: busyState.isShallow,
			isBusy: busyState.isBusy,
			rebaseInProgress: busyState.rebaseInProgress,
			mergeInProgress: busyState.mergeInProgress,
		};
	}

	// ============================================
	// Create branch
	// ============================================

	async createBranch(name: string, workspacePath?: string): Promise<GitActionResult> {
		const cwd = this.resolveGitDir(workspacePath);

		// Pre-check: does branch already exist?
		const check = await this.exec(["git", "show-ref", "--verify", `refs/heads/${name}`], {
			cwd,
			timeoutMs: 10_000,
			env: this.getMutableEnv(),
		});
		if (check.exitCode === 0) {
			return { success: false, code: "BRANCH_EXISTS", message: `Branch '${name}' already exists` };
		}

		const result = await this.exec(["git", "checkout", "-b", name], {
			cwd,
			timeoutMs: 15_000,
			env: this.getMutableEnv(),
		});

		if (result.exitCode !== 0) {
			return {
				success: false,
				code: "UNKNOWN_ERROR",
				message: result.stderr || "Failed to create branch",
			};
		}

		return { success: true, code: "SUCCESS", message: `Created and switched to branch '${name}'` };
	}

	// ============================================
	// Commit
	// ============================================

	async commit(
		message: string,
		includeUntracked: boolean,
		files?: string[],
		workspacePath?: string,
	): Promise<GitActionResult> {
		const cwd = this.resolveGitDir(workspacePath);

		// Stage files
		if (files?.length) {
			const addResult = await this.exec(["git", "add", "--", ...files], {
				cwd,
				timeoutMs: 15_000,
				env: this.getMutableEnv(),
			});
			if (addResult.exitCode !== 0) {
				return {
					success: false,
					code: "UNKNOWN_ERROR",
					message: addResult.stderr || "Failed to stage files",
				};
			}
		} else if (includeUntracked) {
			const addResult = await this.exec(["git", "add", "-A"], {
				cwd,
				timeoutMs: 15_000,
				env: this.getMutableEnv(),
			});
			if (addResult.exitCode !== 0) {
				return {
					success: false,
					code: "UNKNOWN_ERROR",
					message: addResult.stderr || "Failed to stage files",
				};
			}
		} else {
			// Default: tracked files only
			const addResult = await this.exec(["git", "add", "-u"], {
				cwd,
				timeoutMs: 15_000,
				env: this.getMutableEnv(),
			});
			if (addResult.exitCode !== 0) {
				return {
					success: false,
					code: "UNKNOWN_ERROR",
					message: addResult.stderr || "Failed to stage files",
				};
			}
		}

		// Check if there's anything to commit
		// Exit 0 = no diff (nothing staged), exit 1 = has diff, exit >1 = error
		const diffCheck = await this.exec(["git", "diff", "--cached", "--quiet"], {
			cwd,
			timeoutMs: 10_000,
			env: this.getMutableEnv(),
		});
		if (diffCheck.exitCode === 0) {
			return { success: false, code: "NOTHING_TO_COMMIT", message: "Nothing to commit" };
		}
		if (diffCheck.exitCode > 1) {
			return {
				success: false,
				code: "UNKNOWN_ERROR",
				message: diffCheck.stderr || "Failed to check staged changes",
			};
		}

		const commitResult = await this.exec(["git", "commit", "-m", message], {
			cwd,
			timeoutMs: 30_000,
			env: this.getMutableEnv(),
		});

		if (commitResult.exitCode !== 0) {
			const stderr = commitResult.stderr;
			if (stderr.includes("fix conflicts") || stderr.includes("Merge conflict")) {
				return { success: false, code: "MERGE_CONFLICT", message: "Resolve merge conflicts first" };
			}
			if (stderr.includes("index.lock")) {
				return {
					success: false,
					code: "REPO_BUSY",
					message: "Git is busy — try again in a moment",
				};
			}
			return {
				success: false,
				code: "UNKNOWN_ERROR",
				message: stderr || "Commit failed",
			};
		}

		return { success: true, code: "SUCCESS", message: "Changes committed" };
	}

	// ============================================
	// Push
	// ============================================

	async push(workspacePath?: string): Promise<GitActionResult> {
		const cwd = this.resolveGitDir(workspacePath);
		const authEnv = this.getAuthEnv(workspacePath);

		const hasEnvToken = Boolean(authEnv.GIT_TOKEN);
		if (!hasEnvToken && this.repos.length > 0) {
			this.logger?.warn(
				{ repoCount: this.repos.length, workspacePath },
				"No push-capable token available for any repo",
			);
			return {
				success: false,
				code: "AUTH_FAILED",
				message:
					"No push-capable token available. Check that the GitHub App has write access to this repository.",
			};
		}

		try {
			await this.refreshGitCredentialsFile();
		} catch {
			// Non-fatal: commands still have env-token fallback.
		}
		const commandEnv = { ...this.getMutableEnv(), ...authEnv };

		// Get current branch
		const branchResult = await this.exec(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			timeoutMs: 10_000,
			env: commandEnv,
		});
		const branch = branchResult.stdout.trim();

		if (!branch || branch === "HEAD") {
			return { success: false, code: "UNKNOWN_ERROR", message: "Cannot push from detached HEAD" };
		}

		// Detect push strategy
		const pushStrategy = await this.determinePushArgs(cwd, branch);
		if ("error" in pushStrategy) {
			return pushStrategy.error;
		}

		// Attempt push
		let result = await this.exec(["git", "push", ...pushStrategy.args], {
			cwd,
			timeoutMs: 60_000,
			env: commandEnv,
		});

		// If push fails with shallow-related error, try deepening and retry
		if (result.exitCode !== 0 && result.stderr.includes("shallow update not allowed")) {
			await this.exec(["git", "fetch", "--deepen", "100"], {
				cwd,
				timeoutMs: 30_000,
				env: commandEnv,
			});
			result = await this.exec(["git", "push", ...pushStrategy.args], {
				cwd,
				timeoutMs: 60_000,
				env: commandEnv,
			});
			if (result.exitCode !== 0 && result.stderr.includes("shallow")) {
				return {
					success: false,
					code: "SHALLOW_PUSH_FAILED",
					message: "Push failed due to shallow clone",
				};
			}
		}
		if (result.exitCode !== 0) {
			this.logger?.warn(
				{ exitCode: result.exitCode, stderr: result.stderr, hasEnvToken, branch },
				"Git push failed",
			);
			if (
				result.stderr.includes("Authentication failed") ||
				result.stderr.includes("could not read Username") ||
				result.stderr.includes("Invalid credentials")
			) {
				return { success: false, code: "AUTH_FAILED", message: "Authentication failed" };
			}
			return { success: false, code: "UNKNOWN_ERROR", message: result.stderr || "Push failed" };
		}

		this.logger?.info({ branch }, "Git push succeeded");
		return { success: true, code: "SUCCESS", message: `Pushed to ${branch}` };
	}

	private async determinePushArgs(
		cwd: string,
		branch: string,
	): Promise<{ args: string[] } | { error: GitActionResult }> {
		// Check if upstream exists
		const upstreamResult = await this.exec(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], {
			cwd,
			timeoutMs: 10_000,
			env: this.getMutableEnv(),
		});
		if (upstreamResult.exitCode === 0) {
			// Upstream exists, just push
			return { args: [] };
		}

		// No upstream — check for remotes
		const remoteResult = await this.exec(["git", "remote"], {
			cwd,
			timeoutMs: 10_000,
			env: this.getMutableEnv(),
		});
		const remotes = remoteResult.stdout.trim().split("\n").filter(Boolean);

		if (remotes.length === 0) {
			return {
				error: { success: false, code: "NO_REMOTE", message: "No remote configured" },
			};
		}
		if (remotes.includes("origin")) {
			return { args: ["-u", "origin", branch] };
		}
		if (remotes.length === 1) {
			return { args: ["-u", remotes[0], branch] };
		}
		// Multiple remotes, no upstream, no origin — ambiguous
		return {
			error: {
				success: false,
				code: "MULTIPLE_REMOTES",
				message: `Multiple remotes found (${remotes.join(", ")}). Set an upstream or push to a specific remote.`,
			},
		};
	}

	// ============================================
	// Create PR
	// ============================================

	async createPr(
		title: string,
		body?: string,
		baseBranch?: string,
		workspacePath?: string,
	): Promise<GitActionResult> {
		const cwd = this.resolveGitDir(workspacePath);
		const authEnv = this.getAuthEnv(workspacePath);
		const commandEnv = { ...this.getMutableEnv(), ...authEnv, GH_PROMPT_DISABLED: "1" };

		// Push first
		const pushResult = await this.push(workspacePath);
		if (!pushResult.success) {
			return pushResult;
		}

		// Build gh args — always pass --body to prevent interactive prompt
		const args = ["gh", "pr", "create", "--title", title, "--body", body || ""];
		if (baseBranch) {
			args.push("--base", baseBranch);
		}

		const result = await this.exec(args, {
			cwd,
			timeoutMs: 30_000,
			env: commandEnv,
		});

		if (result.exitCode === 127) {
			return {
				success: false,
				code: "GH_NOT_AVAILABLE",
				message: "GitHub CLI (gh) is not available",
			};
		}

		if (result.exitCode !== 0) {
			if (
				result.stderr.includes("not a GitHub repository") ||
				result.stderr.includes("not a git repository")
			) {
				return {
					success: false,
					code: "NOT_GITHUB_REMOTE",
					message: "Remote is not a GitHub repository",
				};
			}
			return {
				success: false,
				code: "UNKNOWN_ERROR",
				message: result.stderr || "Failed to create PR",
			};
		}

		// Get the PR URL reliably via structured output
		const urlResult = await this.exec(["gh", "pr", "view", "--json", "url", "--jq", ".url"], {
			cwd,
			timeoutMs: 10_000,
			env: commandEnv,
		});
		const prUrl = urlResult.exitCode === 0 ? urlResult.stdout.trim() : result.stdout.trim();
		return { success: true, code: "SUCCESS", message: "Pull request created", prUrl };
	}
}

// ============================================
// Parsers (exported for testing)
// ============================================

/**
 * Parse `git status --porcelain=v2 --branch -z` output.
 * NUL-separated for safe path handling.
 */
export function parseStatusV2(
	output: string,
): Omit<GitState, "commits" | "isShallow" | "isBusy" | "rebaseInProgress" | "mergeInProgress"> {
	let branch = "";
	let detached = false;
	let ahead: number | null = null;
	let behind: number | null = null;
	const stagedChanges: GitFileChange[] = [];
	const unstagedChanges: GitFileChange[] = [];
	const untrackedFiles: string[] = [];
	const conflictedFiles: string[] = [];

	if (!output.trim()) {
		return {
			branch,
			detached,
			stagedChanges,
			unstagedChanges,
			untrackedFiles,
			conflictedFiles,
			ahead,
			behind,
		};
	}

	// Split on NUL
	const parts = output.split("\0");
	let i = 0;

	while (i < parts.length) {
		const entry = parts[i];
		if (!entry) {
			i++;
			continue;
		}

		// Branch headers
		if (entry.startsWith("# branch.head ")) {
			const value = entry.slice("# branch.head ".length);
			if (value === "(detached)") {
				detached = true;
				branch = "HEAD (detached)";
			} else {
				branch = value;
			}
			i++;
			continue;
		}

		if (entry.startsWith("# branch.ab ")) {
			const match = entry.match(/\+(\d+) -(\d+)/);
			if (match) {
				ahead = Number.parseInt(match[1], 10);
				behind = Number.parseInt(match[2], 10);
			}
			i++;
			continue;
		}

		// Skip other branch headers
		if (entry.startsWith("# ")) {
			i++;
			continue;
		}

		// Untracked: ? <path>
		if (entry.startsWith("? ")) {
			untrackedFiles.push(entry.slice(2));
			i++;
			continue;
		}

		// Unmerged/conflicted: u <XY> ...
		if (entry.startsWith("u ")) {
			const fields = entry.split(" ");
			// u XY sub m1 m2 m3 mW h1 h2 h3 path
			// path is fields[10+] (may have spaces)
			const filePath = fields.slice(10).join(" ");
			conflictedFiles.push(filePath);
			i++;
			continue;
		}

		// Ordinary changed: 1 <XY> ...
		if (entry.startsWith("1 ")) {
			const fields = entry.split(" ");
			// 1 XY sub mH mI mW hH hI path
			const xy = fields[1];
			const filePath = fields.slice(8).join(" ");
			addChange(xy, filePath, stagedChanges, unstagedChanges);
			i++;
			continue;
		}

		// Rename/copy: 2 <XY> ... path\0origPath
		if (entry.startsWith("2 ")) {
			const fields = entry.split(" ");
			// 2 XY sub mH mI mW hH hI Xscore path
			const xy = fields[1];
			const filePath = fields.slice(9).join(" ");
			// Next NUL-delimited part is the original path
			const origPath = parts[i + 1] || "";
			const displayPath = origPath ? `${origPath} -> ${filePath}` : filePath;
			addChange(xy, displayPath, stagedChanges, unstagedChanges);
			i += 2; // Skip origPath
			continue;
		}

		i++;
	}

	return {
		branch,
		detached,
		stagedChanges,
		unstagedChanges,
		untrackedFiles,
		conflictedFiles,
		ahead,
		behind,
	};
}

function addChange(
	xy: string,
	filePath: string,
	staged: GitFileChange[],
	unstaged: GitFileChange[],
): void {
	const indexStatus = xy[0];
	const worktreeStatus = xy[1];

	// Index has a change (not '.' which means unchanged)
	if (indexStatus !== ".") {
		staged.push({ path: filePath, indexStatus, worktreeStatus: "." });
	}
	// Worktree has a change
	if (worktreeStatus !== ".") {
		unstaged.push({ path: filePath, indexStatus: ".", worktreeStatus });
	}
}

/**
 * Parse `git log --format=%x1e%H%x1f%s%x1f%an%x1f%aI` output.
 * Records separated by \x1e, fields by \x1f.
 */
export function parseLogOutput(output: string): GitCommitSummary[] {
	if (!output.trim()) return [];

	const commits: GitCommitSummary[] = [];
	const records = output.split("\x1e");

	for (const record of records) {
		const trimmed = record.trim();
		if (!trimmed) continue;

		const fields = trimmed.split("\x1f");
		if (fields.length < 4) continue;

		commits.push({
			sha: fields[0],
			message: fields[1],
			author: fields[2],
			date: fields[3],
		});
	}

	return commits;
}

/**
 * Parse the combined plumbing probe output for busy state.
 */
export function parseBusyState(output: string): {
	isShallow: boolean;
	isBusy: boolean;
	rebaseInProgress: boolean;
	mergeInProgress: boolean;
} {
	const result = {
		isShallow: false,
		isBusy: false,
		rebaseInProgress: false,
		mergeInProgress: false,
	};

	for (const line of output.split("\n")) {
		if (line.startsWith("shallow:")) {
			result.isShallow = line.slice("shallow:".length).trim() === "true";
		} else if (line.startsWith("lock:")) {
			result.isBusy = line.slice("lock:".length).trim() === "1";
		} else if (line.startsWith("rebase:")) {
			result.rebaseInProgress = line.slice("rebase:".length).trim() === "1";
		} else if (line.startsWith("merge:")) {
			result.mergeInProgress = line.slice("merge:".length).trim() === "1";
		}
	}

	return result;
}
