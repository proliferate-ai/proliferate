import type { Logger } from "@proliferate/logger";
import type { Sandbox } from "e2b";
import { isValidTargetPath } from "../../../lib/env-parser";
import { DEFAULT_CADDYFILE, SANDBOX_PATHS, shellEscape } from "../../../sandbox";
import type { CreateSandboxOpts } from "../../types";
import { pullOnRestore } from "../create/git-freshness";

/**
 * Runs non-blocking sandbox bootstrap tasks (services, preview proxy, MCP daemons).
 * Failures are logged and do not fail session creation.
 */
export async function setupAdditionalDependencies(
	sandbox: Sandbox,
	opts: CreateSandboxOpts,
	log: Logger,
	providerLogger: Logger,
	llmConfig?: { llmProxyBaseUrl?: string; llmProxyApiKey?: string },
): Promise<void> {
	await pullOnRestore(sandbox, opts, log);

	log.debug("Starting services (async)");
	await sandbox.commands.run("/usr/local/bin/start-services.sh", { timeoutMs: 30000 });

	await sandbox.commands.run(
		`mkdir -p ${SANDBOX_PATHS.userCaddyDir} && touch ${SANDBOX_PATHS.userCaddyFile}`,
		{ timeoutMs: 5000 },
	);

	log.debug("Starting Caddy preview proxy (async)");
	await sandbox.files.write(SANDBOX_PATHS.caddyfile, DEFAULT_CADDYFILE);
	sandbox.commands
		.run(`caddy run --config ${SANDBOX_PATHS.caddyfile}`, { timeoutMs: 3600000 })
		.catch((err: unknown) => {
			providerLogger.debug({ err }, "Caddy process ended");
		});

	log.debug("Starting sandbox-mcp API (async)");
	const sandboxMcpEnvs: Record<string, string> = {
		WORKSPACE_DIR: "/home/user/workspace",
		NODE_ENV: "production",
	};
	if (opts.envVars.SANDBOX_MCP_AUTH_TOKEN) {
		sandboxMcpEnvs.SANDBOX_MCP_AUTH_TOKEN = opts.envVars.SANDBOX_MCP_AUTH_TOKEN;
	}
	sandbox.commands
		.run("sandbox-mcp api > /tmp/sandbox-mcp.log 2>&1", {
			timeoutMs: 3600000,
			envs: sandboxMcpEnvs,
		})
		.catch((err: unknown) => {
			providerLogger.debug({ err }, "sandbox-mcp process ended");
		});

	log.debug("Starting sandbox-daemon (async)");
	const daemonEnvs: Record<string, string> = {
		NODE_ENV: "production",
		PROLIFERATE_WORKSPACE_ROOT: "/home/user/workspace",
	};
	if (opts.envVars.SANDBOX_MCP_AUTH_TOKEN) {
		daemonEnvs.PROLIFERATE_SESSION_TOKEN = opts.envVars.SANDBOX_MCP_AUTH_TOKEN;
	}
	sandbox.commands
		.run("sandbox-daemon > /tmp/sandbox-daemon.log 2>&1", {
			timeoutMs: 3600000,
			envs: daemonEnvs,
		})
		.catch((err: unknown) => {
			providerLogger.warn({ err }, "sandbox-daemon process failed");
		});

	log.debug("Starting sandbox-agent (async)");
	const sandboxAgentEnvs: Record<string, string> = {
		HOME: "/home/user",
		SESSION_ID: opts.sessionId,
		OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
	};
	if (llmConfig?.llmProxyApiKey) {
		sandboxAgentEnvs.ANTHROPIC_API_KEY = llmConfig.llmProxyApiKey;
		if (llmConfig.llmProxyBaseUrl) {
			sandboxAgentEnvs.ANTHROPIC_BASE_URL = llmConfig.llmProxyBaseUrl;
		}
	} else if (opts.envVars.ANTHROPIC_API_KEY) {
		sandboxAgentEnvs.ANTHROPIC_API_KEY = opts.envVars.ANTHROPIC_API_KEY;
	}
	// Manager sessions: Pi extension needs gateway connection info to call control-plane API
	if (opts.sessionKind === "manager") {
		if (opts.envVars.PROLIFERATE_GATEWAY_URL) {
			sandboxAgentEnvs.PROLIFERATE_GATEWAY_URL = opts.envVars.PROLIFERATE_GATEWAY_URL;
		}
		if (opts.envVars.SANDBOX_MCP_AUTH_TOKEN) {
			sandboxAgentEnvs.PROLIFERATE_GATEWAY_AUTH_TOKEN = opts.envVars.SANDBOX_MCP_AUTH_TOKEN;
		}
		sandboxAgentEnvs.PROLIFERATE_MANAGER_SESSION_ID = opts.sessionId;
		// Memory system env vars
		sandboxAgentEnvs.MANAGER_MEMORY_DIR = "/home/user/memory";
		sandboxAgentEnvs.MANAGER_MEMORY_ENABLED = "true";
		// OPENAI_API_KEY for memory embeddings (text-embedding-3-small)
		// This is separate from ANTHROPIC_API_KEY — LLM proxy key is for Claude, not OpenAI
		if (opts.envVars.OPENAI_API_KEY) {
			sandboxAgentEnvs.OPENAI_API_KEY = opts.envVars.OPENAI_API_KEY;
		}
	}
	sandbox.commands
		.run(
			"sandbox-agent server --host 0.0.0.0 --port 2468 --no-token > /tmp/sandbox-agent.log 2>&1",
			{ timeoutMs: 3600000, envs: sandboxAgentEnvs },
		)
		.catch((err: unknown) => {
			providerLogger.warn({ err }, "sandbox-agent process failed");
		});

	void bootServices(sandbox, opts, log);
}

/** Applies secret/env file writes and starts tracked service commands. */
async function bootServices(sandbox: Sandbox, opts: CreateSandboxOpts, log: Logger): Promise<void> {
	const workspaceDir = "/home/user/workspace";

	if (opts.secretFileWrites?.length) {
		for (const fileWrite of opts.secretFileWrites) {
			const normalizedPath = fileWrite.filePath.trim().replace(/^\.\/+/, "");
			if (!isValidTargetPath(normalizedPath)) {
				log.warn({ filePath: fileWrite.filePath }, "Skipping invalid secret file path");
				continue;
			}

			const absolutePath = `${workspaceDir}/${normalizedPath}`;
			const lastSlash = absolutePath.lastIndexOf("/");
			const directory = lastSlash >= 0 ? absolutePath.slice(0, lastSlash) : workspaceDir;

			try {
				await sandbox.commands.run(`mkdir -p ${shellEscape(directory)}`, { timeoutMs: 30_000 });
				await sandbox.files.write(absolutePath, fileWrite.content);
			} catch (err) {
				log.error({ err, filePath: normalizedPath }, "Failed to apply secret file write");
			}
		}
	}

	if (!opts.snapshotHasDeps || !opts.serviceCommands?.length) return;

	for (const cmd of opts.serviceCommands) {
		const baseDir =
			cmd.workspacePath && cmd.workspacePath !== "."
				? `${workspaceDir}/${cmd.workspacePath}`
				: workspaceDir;
		const cwd = cmd.cwd ? `${baseDir}/${cmd.cwd}` : baseDir;
		log.info({ name: cmd.name, cwd }, "Starting service (tracked)");

		sandbox.commands
			.run(
				`proliferate services start --name ${shellEscape(cmd.name)} --command ${shellEscape(cmd.command)} --cwd ${shellEscape(cwd)}`,
				{ timeoutMs: 60000 },
			)
			.catch((err) => {
				log.error({ err, name: cmd.name }, "proliferate services start failed");
			});
	}
}
