/**
 * Sandbox Provider Interface
 *
 * Abstraction layer for sandbox providers (Modal, E2B, etc.)
 * Allows switching providers via config without code changes.
 */

import type { AgentConfig } from "./agents";

export type SandboxProviderType = "modal" | "e2b";

/**
 * Represents file content read from the sandbox filesystem.
 */
export interface FileContent {
	/** Relative path within the folder */
	path: string;
	/** File contents as binary data */
	data: Uint8Array;
}

/**
 * Specification for a single repo in a multi-repo workspace.
 */
export interface RepoSpec {
	repoUrl: string;
	token?: string; // GitHub access token for this repo (may differ per installation)
	workspacePath: string; // Directory name in /workspace/ (e.g., "api", "frontend")
	repoId?: string; // Database repo ID for reference
}

export interface CreateSandboxOpts {
	sessionId: string;
	repos: RepoSpec[]; // Repos to clone (always use this, even for single repo)
	branch: string;
	envVars: Record<string, string>;
	systemPrompt: string;
	snapshotId?: string; // If provided, restore from snapshot instead of cloning
	agentConfig?: AgentConfig;
	/** Current sandbox ID from DB, if any. Used by ensureSandbox to check if existing sandbox is still alive. */
	currentSandboxId?: string;
	/** SSH public key for SSH access */
	sshPublicKey?: string;
	/** Trigger context to write to .proliferate/trigger-context.json */
	triggerContext?: Record<string, unknown>;
}

export interface CreateSandboxResult {
	sandboxId: string;
	tunnelUrl: string;
	previewUrl: string;
	/** SSH host for SSH access */
	sshHost?: string;
	/** SSH port for SSH access */
	sshPort?: number;
	/** Timestamp (ms since epoch) when sandbox will be killed by the provider */
	expiresAt?: number;
}

export interface EnsureSandboxResult extends CreateSandboxResult {
	/** True if we recovered an existing sandbox, false if newly created */
	recovered: boolean;
}

export interface SnapshotResult {
	snapshotId: string;
}

export interface PauseResult {
	snapshotId: string;
}

/**
 * Instructions for cloning a repo in terminal sessions.
 */
export interface CloneInstructions {
	cloneUrl: string;
	branch: string;
	checkoutSha: string;
	subdirectory: string;
}

/**
 * Options for creating a terminal sandbox (SSH-enabled, for CLI sessions).
 */
export interface CreateTerminalSandboxOpts {
	sessionId: string;
	userPublicKeys: string[];
	localPath?: string;
	snapshotId?: string;
	gitToken?: string;
	envVars?: Record<string, string>;
	cloneInstructions?: CloneInstructions;
}

/**
 * Result from creating a terminal sandbox.
 */
export interface CreateTerminalSandboxResult {
	sandboxId: string;
	sshHost: string;
	sshPort: number;
	previewUrl: string;
}

export interface SandboxProvider {
	readonly type: SandboxProviderType;
	/** True if provider can pause a sandbox and later resume from the same ID. */
	readonly supportsPause?: boolean;
	/** True if provider auto-pauses sandboxes on expiry (no explicit snapshot needed for idle sessions). */
	readonly supportsAutoPause?: boolean;

	/**
	 * Ensure a sandbox exists for this session.
	 *
	 * Single entry point that handles all cases:
	 * 1. If a sandbox with this sessionId already exists and is alive → recover it
	 * 2. Otherwise → create a new one (from snapshot if provided, else fresh clone)
	 *
	 * This is the preferred method for session initialization.
	 */
	ensureSandbox(opts: CreateSandboxOpts): Promise<EnsureSandboxResult>;

	/**
	 * Create a new sandbox, optionally from a snapshot.
	 * If snapshotId is provided, restores from that snapshot.
	 * Otherwise creates a fresh sandbox with repo cloned.
	 *
	 * Use this when you explicitly want a fresh sandbox.
	 * Use ensureSandbox() when you want recovery-with-fallback-to-create behavior.
	 */
	createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult>;

	/**
	 * Take a filesystem snapshot of a running sandbox.
	 * Returns a snapshot ID that can be used to restore later.
	 */
	snapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult>;
	/**
	 * Pause a running sandbox. Returns a snapshotId used to resume later.
	 * Some providers map this 1:1 to snapshot().
	 */
	pause(sessionId: string, sandboxId: string): Promise<PauseResult>;

	/**
	 * Terminate a sandbox and free resources.
	 * @param sessionId - Our internal session ID (used by Modal)
	 * @param sandboxId - The provider's sandbox ID (used by E2B)
	 */
	terminate(sessionId: string, sandboxId?: string): Promise<void>;

	/**
	 * Write environment variables to a file inside the sandbox.
	 * Variables are written to /tmp/.proliferate_env.json
	 */
	writeEnvFile(sandboxId: string, envVars: Record<string, string>): Promise<void>;

	/**
	 * Check if the provider's API is healthy.
	 */
	health(): Promise<boolean>;

	/**
	 * Check which sandboxes are still alive.
	 * Returns array of sandbox IDs that are still running.
	 */
	checkSandboxes?(sandboxIds: string[]): Promise<string[]>;

	/**
	 * Resolve tunnel URLs for an existing sandbox.
	 * Providers may return updated URLs after resume/restart.
	 * Useful for migration scenarios where we have a sandboxId but need fresh URLs.
	 */
	resolveTunnels?(sandboxId: string): Promise<{
		openCodeUrl: string;
		previewUrl: string;
	}>;

	/**
	 * Read files from a folder in the sandbox filesystem.
	 * Returns array of files with their relative paths and binary contents.
	 *
	 * @param sandboxId - The sandbox ID
	 * @param folderPath - Absolute path to folder in sandbox
	 * @returns Array of files found in the folder (recursively)
	 */
	readFiles?(sandboxId: string, folderPath: string): Promise<FileContent[]>;

	/**
	 * Create a terminal sandbox with SSH access (used by CLI sessions).
	 * Not all providers support this - check availability before calling.
	 */
	createTerminalSandbox?(opts: CreateTerminalSandboxOpts): Promise<CreateTerminalSandboxResult>;

	/**
	 * Read files from a folder in the sandbox filesystem.
	 * Returns array of files with their relative paths and binary contents.
	 *
	 * @param sandboxId - The sandbox ID
	 * @param folderPath - Absolute path to folder in sandbox
	 * @returns Array of files found in the folder (recursively)
	 */
	readFiles?(sandboxId: string, folderPath: string): Promise<FileContent[]>;

	/**
	 * Create a terminal sandbox with SSH access (used by CLI sessions).
	 * Not all providers support this - check availability before calling.
	 */
	createTerminalSandbox?(opts: CreateTerminalSandboxOpts): Promise<CreateTerminalSandboxResult>;
}
