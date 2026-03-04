import { Sandbox } from "e2b";
import { getLLMProxyBaseURL } from "../../../agents/llm-proxy";
import { SANDBOX_PATHS, SANDBOX_TIMEOUT_MS } from "../../../sandbox";
import { E2B_TEMPLATE, getE2BApiOpts, getE2BConnectOpts } from "../shared/config";
import type {
	CreateSandboxContext,
	PreparedSandboxEnv,
	SandboxInitializationResult,
} from "../shared/types";

/** Builds the jq-based env export command for resumed snapshots. */
function buildEnvExportCommand(): string {
	return `for key in $(jq -r 'keys[]' ${SANDBOX_PATHS.envProfileFile}); do export "$key=$(jq -r --arg k "$key" '.[$k]' ${SANDBOX_PATHS.envProfileFile})"; done`;
}

/**
 * Normalizes sandbox env vars and wires LLM proxy values when available.
 * Also forces OpenCode default plugins off so provider tools remain authoritative.
 */
export function prepareSandboxEnvironment(
	envVars: Record<string, string>,
	sessionId: string,
	log: CreateSandboxContext["log"],
): PreparedSandboxEnv {
	const llmProxyBaseUrl = getLLMProxyBaseURL();
	const llmProxyApiKey = envVars.LLM_PROXY_API_KEY;

	const envs: Record<string, string> = {
		SESSION_ID: sessionId,
	};

	if (llmProxyBaseUrl && llmProxyApiKey) {
		log.debug({ llmProxyBaseUrl }, "Using LLM proxy");
		envs.ANTHROPIC_API_KEY = llmProxyApiKey;
		envs.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
	} else {
		const hasDirectKey = Boolean(envVars.ANTHROPIC_API_KEY);
		log.warn({ hasDirectKey }, "No LLM proxy, using direct key");
		envs.ANTHROPIC_API_KEY = envVars.ANTHROPIC_API_KEY || "";
	}

	for (const [key, value] of Object.entries(envVars)) {
		if (
			key === "ANTHROPIC_API_KEY" ||
			key === "LLM_PROXY_API_KEY" ||
			key === "ANTHROPIC_BASE_URL"
		) {
			continue;
		}
		envs[key] = value;
	}

	envs.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true";
	return { envs, llmProxyBaseUrl, llmProxyApiKey };
}

/**
 * Creates or restores a sandbox from snapshot and guarantees a usable instance.
 * Snapshot failures are treated as non-fatal and transparently fall back to fresh create.
 */
export async function initializeSandbox(
	context: CreateSandboxContext,
): Promise<SandboxInitializationResult> {
	const { opts } = context;
	const sandboxCreatedAt = Date.now();
	const preparedEnv = prepareSandboxEnvironment(opts.envVars, opts.sessionId, context.log);
	let isSnapshot = Boolean(opts.snapshotId);

	const sandboxOpts: Parameters<typeof Sandbox.create>[1] = {
		timeoutMs: SANDBOX_TIMEOUT_MS,
		envs: preparedEnv.envs,
	};
	const apiDomain = getE2BApiOpts().domain;
	if (apiDomain) {
		sandboxOpts.domain = apiDomain;
	}

	let sandbox: Sandbox | null = null;
	if (isSnapshot) {
		try {
			if (opts.currentSandboxId) {
				context.log.debug({ sandboxId: opts.currentSandboxId }, "Resuming paused sandbox");
				sandbox = await Sandbox.connect(opts.currentSandboxId, getE2BConnectOpts());
			} else {
				context.log.debug({ snapshotId: opts.snapshotId }, "Creating sandbox from snapshot");
				sandbox = await Sandbox.create(opts.snapshotId!, sandboxOpts);
			}
			context.log.info({ sandboxId: sandbox.sandboxId }, "Sandbox ready from snapshot");

			let envsForProfile = { ...preparedEnv.envs };
			if (preparedEnv.llmProxyBaseUrl && preparedEnv.llmProxyApiKey) {
				const {
					ANTHROPIC_API_KEY: _apiKey,
					ANTHROPIC_BASE_URL: _baseUrl,
					...rest
				} = envsForProfile;
				envsForProfile = rest;
			}

			await sandbox.files.write(SANDBOX_PATHS.envProfileFile, JSON.stringify(envsForProfile));
			await sandbox.commands.run(buildEnvExportCommand(), { timeoutMs: 10000 });
		} catch (err) {
			context.log.warn({ err }, "Snapshot resume failed, falling back to fresh sandbox");
			isSnapshot = false;
		}
	}

	if (!isSnapshot) {
		if (!E2B_TEMPLATE) {
			throw new Error("E2B_TEMPLATE is required to create a sandbox");
		}
		sandbox = await Sandbox.create(E2B_TEMPLATE, sandboxOpts);
		context.log.info({ sandboxId: sandbox.sandboxId }, "Fresh sandbox created");
	}

	if (!sandbox) {
		throw new Error("Failed to initialize sandbox");
	}

	return { sandbox, isSnapshot, sandboxCreatedAt, preparedEnv };
}

/** Returns sandbox id only when the provided sandbox is still running. */
export async function findRunningSandbox(sandboxId: string | undefined): Promise<string | null> {
	if (!sandboxId) return null;

	try {
		const info = await Sandbox.getInfo(sandboxId, getE2BApiOpts());
		return info.endAt ? null : info.sandboxId;
	} catch {
		return null;
	}
}
