import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@proliferate/logger";
import type { Sandbox } from "e2b";
import { getDefaultAgentConfig, toOpencodeModelId } from "../../../agents";
import {
	INITIAL_MEMORY_TEMPLATE,
	MEMORY_SYSTEM_PROMPT_SECTION,
} from "../../../manager/memory-constants";
import {
	AUTOMATION_COMPLETE_DESCRIPTION,
	AUTOMATION_COMPLETE_TOOL,
	SAVE_SERVICE_COMMANDS_DESCRIPTION,
	SAVE_SERVICE_COMMANDS_TOOL,
	SAVE_SNAPSHOT_DESCRIPTION,
	SAVE_SNAPSHOT_TOOL,
	VERIFY_TOOL,
	VERIFY_TOOL_DESCRIPTION,
} from "../../../opencode-tools";
import {
	ACTIONS_BOOTSTRAP,
	ENV_INSTRUCTIONS,
	PLUGIN_MJS,
	SANDBOX_PATHS,
	getOpencodeConfig,
} from "../../../sandbox";
import type { CreateSandboxOpts } from "../../types";

const ACTIONS_CLI_PROMPT_SECTION = `
## External Actions (Integrations)

Use the \`proliferate\` CLI to interact with connected integrations (Linear, Sentry, GitHub, Slack, etc.):

- \`proliferate actions list\` — see available integrations and actions
- \`proliferate actions guide --integration <name>\` — detailed usage guide for a specific integration
- \`proliferate actions run --integration <name> --action <action> --params '<json>'\` — invoke an action

Actions may require approval depending on their risk level.
`.trim();

/**
 * Resolve a local bundle file by trying multiple candidate paths relative to cwd.
 * Returns the file content or null if not found.
 */
function resolveLocalBundle(relativePath: string): string | null {
	const cwd = process.cwd();
	const candidates = [
		resolve(cwd, `packages/${relativePath}`),
		resolve(cwd, `../../packages/${relativePath}`),
		resolve(cwd, `../packages/${relativePath}`),
		resolve(cwd, `../../../packages/${relativePath}`),
	];
	for (const candidate of candidates) {
		try {
			return readFileSync(candidate, "utf-8");
		} catch {
			// Try next candidate
		}
	}
	return null;
}

/**
 * Performs blocking sandbox bootstrap required before the session can accept prompts:
 * tools, instructions, config, and OpenCode process startup.
 */
export async function setupEssentialDependencies(
	sandbox: Sandbox,
	repoDir: string,
	opts: CreateSandboxOpts,
	log: Logger,
	llmProxyBaseUrl?: string,
	llmProxyApiKey?: string,
): Promise<void> {
	const globalOpencodeDir = SANDBOX_PATHS.globalOpencodeDir;
	const globalPluginDir = SANDBOX_PATHS.globalPluginDir;
	const localOpencodeDir = `${repoDir}/.opencode`;
	const localToolDir = `${localOpencodeDir}/tool`;
	const repoInstructions = [".opencode/instructions.md", "AGENTS.md"];

	const agentConfig = opts.agentConfig || getDefaultAgentConfig();
	const opencodeModelId = toOpencodeModelId(agentConfig.modelId);
	const globalOpencodeConfig =
		llmProxyBaseUrl && llmProxyApiKey
			? getOpencodeConfig(opencodeModelId, llmProxyBaseUrl)
			: getOpencodeConfig(opencodeModelId);
	const repoOpencodeConfig =
		llmProxyBaseUrl && llmProxyApiKey
			? getOpencodeConfig(opencodeModelId, llmProxyBaseUrl, undefined, repoInstructions)
			: getOpencodeConfig(opencodeModelId, undefined, undefined, repoInstructions);
	if (llmProxyBaseUrl && llmProxyApiKey) {
		log.debug({ llmProxyBaseUrl }, "Using LLM proxy");
	} else {
		log.debug("Direct API mode (no proxy)");
	}
	log.debug({ modelId: agentConfig.modelId, opencodeModelId }, "Using model");

	const basePrompt = opts.systemPrompt || "You are a senior engineer working on this codebase.";
	const instructions = `${basePrompt}\n\n${ENV_INSTRUCTIONS}`;

	const writeFile = async (path: string, content: string) => {
		const dir = path.substring(0, path.lastIndexOf("/"));
		await sandbox.commands.run(`mkdir -p ${dir}`, { timeoutMs: 10000 });
		await sandbox.files.write(path, content);
	};

	log.debug("Writing OpenCode files (parallel)");
	const isSetupSession = opts.sessionType === "setup";
	const writePromises = [
		writeFile(`${globalPluginDir}/proliferate.mjs`, PLUGIN_MJS),
		writeFile(`${localToolDir}/verify.ts`, VERIFY_TOOL),
		writeFile(`${localToolDir}/verify.txt`, VERIFY_TOOL_DESCRIPTION),
		writeFile(`${localToolDir}/save_snapshot.ts`, SAVE_SNAPSHOT_TOOL),
		writeFile(`${localToolDir}/save_snapshot.txt`, SAVE_SNAPSHOT_DESCRIPTION),
		writeFile(`${localToolDir}/automation_complete.ts`, AUTOMATION_COMPLETE_TOOL),
		writeFile(`${localToolDir}/automation_complete.txt`, AUTOMATION_COMPLETE_DESCRIPTION),
		writeFile(`${globalOpencodeDir}/opencode.json`, globalOpencodeConfig),
		writeFile(`${repoDir}/opencode.json`, repoOpencodeConfig),
		writeFile(`${localOpencodeDir}/instructions.md`, instructions),
		writeFile(`${repoDir}/.proliferate/actions-guide.md`, ACTIONS_BOOTSTRAP),
		(async () => {
			await sandbox.commands.run(`mkdir -p ${localToolDir}`, { timeoutMs: 10000 });
			await sandbox.commands.run(
				`cp ${SANDBOX_PATHS.preinstalledToolsDir}/package.json ${localToolDir}/ && ` +
					`cp -r ${SANDBOX_PATHS.preinstalledToolsDir}/node_modules ${localToolDir}/`,
				{ timeoutMs: 30000 },
			);
		})(),
	];

	if (isSetupSession) {
		writePromises.push(
			writeFile(`${localToolDir}/save_service_commands.ts`, SAVE_SERVICE_COMMANDS_TOOL),
			writeFile(`${localToolDir}/save_service_commands.txt`, SAVE_SERVICE_COMMANDS_DESCRIPTION),
		);
	} else {
		writePromises.push(
			(async () => {
				await sandbox.commands.run(
					`rm -f ${localToolDir}/save_service_commands.ts ${localToolDir}/save_service_commands.txt`,
					{ timeoutMs: 10000 },
				);
			})(),
		);
	}

	// For manager sessions, write Pi extensions and initialize memory system.
	// pi-acp auto-discovers extensions from ~/.pi/agent/extensions/
	const isManagerSession = opts.sessionKind === "manager";
	if (isManagerSession) {
		// Manager tools extension (spawn_child, list_repos, etc.) — bundled .mjs
		const managerToolsBundle = resolveLocalBundle("pi-extensions/dist/manager-tools.mjs");
		if (managerToolsBundle) {
			writePromises.push(
				writeFile(
					"/home/user/.pi/agent/extensions/manager-tools-extension.mjs",
					managerToolsBundle,
				),
			);
		} else {
			log.error("pi-extensions manager-tools bundle not found, manager tools will be unavailable");
		}
		// Memory system extension (memory_search, memory_get) — bundled .mjs
		const memoryToolsBundle = resolveLocalBundle("pi-extensions/dist/memory-tools.mjs");
		if (memoryToolsBundle) {
			writePromises.push(
				writeFile("/home/user/.pi/agent/extensions/memory-system-extension.mjs", memoryToolsBundle),
			);
		} else {
			log.error("pi-extensions memory-tools bundle not found, memory tools will be unavailable");
		}
		// Write sandbox-memory bundle if not already in the template
		// In prod, the Dockerfile COPYs it; in dev, we write it from the local build
		writePromises.push(
			(async () => {
				const bundleCheck = await sandbox.commands.run(
					"ls /home/user/.proliferate/sandbox-memory.cjs > /dev/null 2>&1 && echo exists || echo missing",
					{ timeoutMs: 5000 },
				);
				if (bundleCheck.stdout.trim() === "missing") {
					const bundleContent = resolveLocalBundle("sandbox-memory/dist/sandbox-memory.cjs");
					if (bundleContent) {
						try {
							await sandbox.files.write(
								"/home/user/.proliferate/sandbox-memory.cjs",
								bundleContent,
							);
							log.debug("Wrote sandbox-memory.cjs bundle to sandbox");
						} catch (err) {
							log.debug({ err }, "Failed to write sandbox-memory.cjs bundle");
						}
					} else {
						log.debug(
							"sandbox-memory.cjs bundle not found locally, memory tools will be unavailable",
						);
					}
				}
			})(),
		);
		// Ensure better-sqlite3 is available for sandbox-memory.cjs.
		// The bundle lives at /home/user/.proliferate/sandbox-memory.cjs and uses
		// require("better-sqlite3") — Node resolves this from the file's directory.
		// Pre-installed in template via Dockerfile; install at runtime as fallback for dev.
		writePromises.push(
			(async () => {
				const sqliteCheck = await sandbox.commands.run(
					"node -e \"try { require('/home/user/.proliferate/node_modules/better-sqlite3'); console.log('ok') } catch { try { require('better-sqlite3'); console.log('ok') } catch { console.log('missing') } }\"",
					{ timeoutMs: 10000 },
				);
				if (sqliteCheck.stdout.trim() === "missing") {
					log.debug("better-sqlite3 not found in sandbox, installing near bundle...");
					const installResult = await sandbox.commands.run(
						"cd /home/user/.proliferate && npm init -y > /dev/null 2>&1 && npm install better-sqlite3@11 2>&1",
						{ timeoutMs: 120000 },
					);
					if (installResult.exitCode === 0) {
						log.debug("better-sqlite3 installed near bundle");
					} else {
						log.warn({ stderr: installResult.stderr }, "Failed to install better-sqlite3");
					}
				}
			})(),
		);
		// Initialize memory directory and seed MEMORY.md (first boot only — on resume the file already exists)
		writePromises.push(
			(async () => {
				await sandbox.commands.run("mkdir -p /home/user/memory", { timeoutMs: 10000 });
				// Use ls to check file existence (test -f throws on non-zero exit in E2B SDK)
				const check = await sandbox.commands.run(
					"ls /home/user/memory/MEMORY.md > /dev/null 2>&1 && echo exists || echo missing",
					{ timeoutMs: 5000 },
				);
				if (check.stdout.trim() === "missing") {
					await sandbox.files.write("/home/user/memory/MEMORY.md", INITIAL_MEMORY_TEMPLATE);
				}
			})(),
		);
		// Write system prompt with memory guidance and actions CLI instructions
		writePromises.push(
			writeFile(
				"/home/user/.proliferate/system-prompt.md",
				`${basePrompt}\n\n${MEMORY_SYSTEM_PROMPT_SECTION}\n\n${ACTIONS_CLI_PROMPT_SECTION}`,
			),
		);
	}

	await Promise.all(writePromises);

	// OpenCode and Pi are started on-demand by sandbox-agent via ACP protocol.
	// Config files written above are read by agents when sandbox-agent launches them.
	log.debug("Essential bootstrap complete (sandbox-agent manages agent lifecycle)");
}
