import type { Logger } from "@proliferate/logger";
import type { Sandbox } from "e2b";
import { getDefaultAgentConfig, toOpencodeModelId } from "../../../agents";
import { PI_MANAGER_EXTENSION } from "../../../manager/pi-manager-extension";
import {
	AUTOMATION_COMPLETE_DESCRIPTION,
	AUTOMATION_COMPLETE_TOOL,
	REQUEST_ENV_VARIABLES_DESCRIPTION,
	REQUEST_ENV_VARIABLES_TOOL,
	SAVE_ENV_FILES_DESCRIPTION,
	SAVE_ENV_FILES_TOOL,
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
		writeFile(`${localToolDir}/request_env_variables.ts`, REQUEST_ENV_VARIABLES_TOOL),
		writeFile(`${localToolDir}/request_env_variables.txt`, REQUEST_ENV_VARIABLES_DESCRIPTION),
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
			writeFile(`${localToolDir}/save_env_files.ts`, SAVE_ENV_FILES_TOOL),
			writeFile(`${localToolDir}/save_env_files.txt`, SAVE_ENV_FILES_DESCRIPTION),
		);
	} else {
		writePromises.push(
			(async () => {
				await sandbox.commands.run(
					`rm -f ${localToolDir}/save_service_commands.ts ${localToolDir}/save_service_commands.txt ${localToolDir}/save_env_files.ts ${localToolDir}/save_env_files.txt`,
					{ timeoutMs: 10000 },
				);
			})(),
		);
	}

	// For manager sessions, write the Pi extension that registers manager tools.
	// pi-acp auto-discovers extensions from ~/.pi/agent/extensions/
	const isManagerSession = opts.sessionKind === "manager";
	if (isManagerSession) {
		writePromises.push(
			writeFile("/home/user/.pi/agent/extensions/manager-tools-extension.ts", PI_MANAGER_EXTENSION),
		);
	}

	await Promise.all(writePromises);

	// OpenCode and Pi are started on-demand by sandbox-agent via ACP protocol.
	// Config files written above are read by agents when sandbox-agent launches them.
	log.debug("Essential bootstrap complete (sandbox-agent manages agent lifecycle)");
}
