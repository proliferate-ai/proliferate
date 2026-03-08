import { env } from "@proliferate/environment/server";
import { Sandbox } from "e2b";
import { getSharedLogger } from "../logger";
import { SandboxProviderError, capOutput, shellEscape } from "../sandbox";
import { setupAdditionalDependencies } from "./e2b/bootstrap/background";
import { setupEssentialDependencies } from "./e2b/bootstrap/essential";
import { findRunningSandbox, initializeSandbox } from "./e2b/create/initialize";
import { setupWorkspace } from "./e2b/create/workspace";
import {
	buildCreateSandboxExpiresAt,
	execSandboxCommand,
	readSandboxFiles,
	resolveTunnelUrls,
	writeSandboxEnvFile,
} from "./e2b/runtime/io";
import { getE2BApiOpts, getE2BConnectOpts } from "./e2b/shared/config";
import type {
	AutoStartOutputEntry,
	ConfigurationServiceCommand,
	CreateSandboxOpts,
	CreateSandboxResult,
	EnsureSandboxResult,
	FileContent,
	PauseResult,
	SandboxProvider,
	SnapshotResult,
} from "./types";

/** Kills stale listeners/processes that can conflict with restored snapshots. */
const CLEAR_STALE_PROCESSES_COMMAND =
	"fuser -k -9 4096/tcp 4000/tcp 8470/tcp 2468/tcp 2>/dev/null || true; pkill -9 caddy || true; pkill -9 sandbox-daemon || true; pkill -9 sandbox-agent || true; pkill -9 sandbox-mcp || true; sleep 2";

const log = getSharedLogger().child({ module: "e2b" });

export class E2BProvider implements SandboxProvider {
	readonly type = "e2b" as const;
	readonly supportsPause = true;
	readonly supportsAutoPause = true;

	async createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult> {
		const sessionLog = log.child({ sessionId: opts.sessionId });

		// 1. Create or restore sandbox (snapshot resume with fresh-create fallback)
		const { sandbox, isSnapshot, sandboxCreatedAt, preparedEnv } = await initializeSandbox({
			opts,
			log: sessionLog,
		});

		// 2. Resolve workspace directory (clone repos or read metadata from snapshot)
		const repoDir = await setupWorkspace(sandbox, opts, isSnapshot, sessionLog);

		// 3. Kill frozen processes from snapshot to avoid port conflicts before bootstrap
		if (isSnapshot) {
			await sandbox.commands
				.run(CLEAR_STALE_PROCESSES_COMMAND, { timeoutMs: 10000 })
				.catch(() => {});
		}

		// 4. Blocking bootstrap: write tools/config/instructions, start OpenCode server
		await setupEssentialDependencies(
			sandbox,
			repoDir,
			opts,
			sessionLog,
			preparedEnv.llmProxyBaseUrl,
			preparedEnv.llmProxyApiKey,
		);

		// 5. Non-blocking bootstrap: sidecars, preview proxy, git freshness, service commands
		setupAdditionalDependencies(sandbox, opts, sessionLog, log, {
			llmProxyBaseUrl: preparedEnv.llmProxyBaseUrl,
			llmProxyApiKey: preparedEnv.llmProxyApiKey,
		}).catch((err) => {
			sessionLog.warn({ err }, "Additional dependencies setup failed");
		});

		// 6. Resolve tunnel URLs for preview (sandbox-agent starts agents on demand via ACP)
		const previewHost = sandbox.getHost(20000);
		const previewUrl = previewHost ? `https://${previewHost}` : "";
		// tunnelUrl points to sandbox-agent ACP via Caddy /v1/* route (same host as preview)
		const tunnelUrl = previewUrl;

		sessionLog.info({ sandboxId: sandbox.sandboxId, isSnapshot }, "Sandbox created");

		return {
			sandboxId: sandbox.sandboxId,
			tunnelUrl,
			previewUrl,
			expiresAt: buildCreateSandboxExpiresAt(sandboxCreatedAt),
		};
	}

	async ensureSandbox(opts: CreateSandboxOpts): Promise<EnsureSandboxResult> {
		const sessionLog = log.child({ sessionId: opts.sessionId });

		// Try to recover an existing running sandbox (side-effect-free check)
		const existingSandboxId = await findRunningSandbox(opts.currentSandboxId);

		if (existingSandboxId) {
			const tunnels = await resolveTunnelUrls(existingSandboxId);
			sessionLog.info({ sandboxId: existingSandboxId }, "Sandbox recovered");
			return {
				sandboxId: existingSandboxId,
				tunnelUrl: tunnels.openCodeUrl,
				previewUrl: tunnels.previewUrl,
				recovered: true,
			};
		}

		// No running sandbox found — full create path
		const result = await this.createSandbox(opts);
		return { ...result, recovered: false };
	}

	async testServiceCommands(
		sandboxId: string,
		commands: ConfigurationServiceCommand[],
		opts: { timeoutMs: number; runId: string },
	): Promise<AutoStartOutputEntry[]> {
		const cmdLog = log.child({ sandboxId: sandboxId.slice(0, 16), runId: opts.runId });
		cmdLog.info({ commandCount: commands.length }, "Testing service commands");

		const sandbox = await Sandbox.connect(sandboxId, getE2BConnectOpts());
		const workspaceDir = "/home/user/workspace";
		const entries: AutoStartOutputEntry[] = [];

		for (let i = 0; i < commands.length; i++) {
			const cmd = commands[i];
			const baseDir =
				cmd.workspacePath && cmd.workspacePath !== "."
					? `${workspaceDir}/${cmd.workspacePath}`
					: workspaceDir;
			const cwd = cmd.cwd ? `${baseDir}/${cmd.cwd}` : baseDir;
			const slug = cmd.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
			const logFile = `/tmp/auto-start-test-${opts.runId}-${i}-${slug}.log`;

			try {
				const result = await sandbox.commands.run(
					`cd ${shellEscape(cwd)} && sh -c ${shellEscape(cmd.command)} > ${shellEscape(logFile)} 2>&1; EXIT_CODE=$?; cat ${shellEscape(logFile)}; exit $EXIT_CODE`,
					{ timeoutMs: opts.timeoutMs },
				);
				entries.push({
					name: cmd.name,
					workspacePath: cmd.workspacePath,
					cwd,
					output: capOutput(result.stdout + result.stderr),
					exitCode: result.exitCode,
					logFile,
				});
			} catch (err) {
				cmdLog.error({ err, name: cmd.name }, "Test command failed");
				entries.push({
					name: cmd.name,
					workspacePath: cmd.workspacePath,
					cwd,
					output: err instanceof Error ? err.message : "Command execution failed",
					exitCode: 1,
					logFile,
				});
			}
		}

		return entries;
	}

	async execCommand(
		sandboxId: string,
		argv: string[],
		opts?: {
			cwd?: string;
			timeoutMs?: number;
			env?: Record<string, string>;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return execSandboxCommand(sandboxId, argv, opts);
	}

	async snapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult> {
		const result = await Sandbox.createSnapshot(sandboxId, getE2BApiOpts());
		log.info({ sessionId, sandboxId, snapshotId: result.snapshotId }, "Snapshot created");
		return { snapshotId: result.snapshotId };
	}

	async pause(sessionId: string, sandboxId: string): Promise<PauseResult> {
		// E2B pause freezes the sandbox in place; the sandboxId becomes the resume handle
		await Sandbox.betaPause(sandboxId, getE2BApiOpts());
		log.info({ sessionId, sandboxId }, "Sandbox paused");
		return { snapshotId: sandboxId };
	}

	async terminate(sessionId: string, sandboxId?: string): Promise<void> {
		if (!sandboxId) {
			throw new SandboxProviderError({
				provider: "e2b",
				operation: "terminate",
				message: "sandboxId is required for terminate",
				isRetryable: false,
			});
		}

		try {
			await Sandbox.kill(sandboxId, getE2BApiOpts());
			log.info({ sessionId, sandboxId }, "Sandbox terminated");
		} catch (error) {
			// Treat "not found" as success — sandbox is already gone
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.includes("not found") ||
				errorMessage.includes("404") ||
				errorMessage.includes("does not exist")
			) {
				log.debug({ sessionId, sandboxId }, "Sandbox already terminated (idempotent)");
				return;
			}
			throw SandboxProviderError.fromError(error, "e2b", "terminate");
		}
	}

	async writeEnvFile(sandboxId: string, envVars: Record<string, string>): Promise<void> {
		await writeSandboxEnvFile(sandboxId, envVars);
	}

	async health(): Promise<boolean> {
		try {
			if (!env.E2B_API_KEY) {
				log.warn("Health check failed: E2B_API_KEY not set");
				return false;
			}
			await Sandbox.list(getE2BApiOpts());
			return true;
		} catch (error) {
			log.warn({ err: error }, "Health check failed");
			return false;
		}
	}

	async resolveTunnels(sandboxId: string): Promise<{ openCodeUrl: string; previewUrl: string }> {
		return resolveTunnelUrls(sandboxId);
	}

	async readFiles(sandboxId: string, folderPath: string): Promise<FileContent[]> {
		const files = await readSandboxFiles(sandboxId, folderPath);
		log.debug(
			{ sandboxId: sandboxId.slice(0, 16), folderPath, fileCount: files.length },
			"Read files from sandbox",
		);
		return files;
	}

	async checkSandboxes(sandboxIds: string[]): Promise<string[]> {
		if (sandboxIds.length === 0) {
			return [];
		}

		// Uses Sandbox.list() (not connect) to avoid resuming paused sandboxes
		try {
			const paginator = Sandbox.list(getE2BApiOpts());
			const runningSandboxIds: string[] = [];
			while (paginator.hasNext) {
				const items = await paginator.nextItems();
				for (const sandbox of items) {
					runningSandboxIds.push(sandbox.sandboxId);
				}
			}

			const runningIds = new Set(runningSandboxIds);
			return sandboxIds.filter((id) => runningIds.has(id));
		} catch (error) {
			log.error({ err: error }, "Failed to list sandboxes");
			return [];
		}
	}
}
