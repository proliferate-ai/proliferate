import { Sandbox } from "e2b";
import { getLLMProxyBaseURL } from "../../agents/llm-proxy";
import { SANDBOX_PATHS, SANDBOX_TIMEOUT_MS } from "../../sandbox";
import { buildEnvExportCommand } from "./commands";
import type {
	CreateSandboxContext,
	PreparedSandboxEnv,
	SandboxInitializationResult,
} from "./types";

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
		log.debug({ llmProxyBaseUrl, hasApiKey: true }, "Using LLM proxy");
		envs.ANTHROPIC_API_KEY = llmProxyApiKey;
		envs.ANTHROPIC_BASE_URL = llmProxyBaseUrl;
	} else {
		const hasDirectKey = Boolean(envVars.ANTHROPIC_API_KEY);
		log.warn({ hasDirectKey }, "No LLM proxy, using direct key");
		envs.ANTHROPIC_API_KEY = envVars.ANTHROPIC_API_KEY || "";
	}

	for (const [key, value] of Object.entries(envVars)) {
		if (key === "ANTHROPIC_API_KEY" || key === "LLM_PROXY_API_KEY" || key === "ANTHROPIC_BASE_URL") {
			continue;
		}
		envs[key] = value;
	}

	envs.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true";
	return { envs, llmProxyBaseUrl, llmProxyApiKey };
}

export async function initializeSandbox(
	context: CreateSandboxContext,
): Promise<SandboxInitializationResult> {
	const { opts, providerType, logLatency, getConnectOpts, templateId } = context;
	const sandboxCreatedAt = Date.now();
	const preparedEnv = prepareSandboxEnvironment(opts.envVars, opts.sessionId, context.log);
	let isSnapshot = Boolean(opts.snapshotId);

	const sandboxOpts: Parameters<typeof Sandbox.create>[1] = {
		timeoutMs: SANDBOX_TIMEOUT_MS,
		envs: preparedEnv.envs,
	};
	const apiDomain = context.getApiOpts().domain;
	if (apiDomain) {
		sandboxOpts.domain = apiDomain;
	}

	let sandbox: Sandbox | null = null;
	if (isSnapshot) {
		try {
			const connectStartMs = Date.now();
			if (opts.currentSandboxId) {
				context.log.debug({ sandboxId: opts.currentSandboxId }, "Resuming paused sandbox");
				sandbox = await Sandbox.connect(opts.currentSandboxId, getConnectOpts());
			} else {
				context.log.debug({ snapshotId: opts.snapshotId }, "Creating sandbox from snapshot");
				sandbox = await Sandbox.create(opts.snapshotId!, sandboxOpts);
			}
			logLatency("provider.create_sandbox.resume.connect", {
				provider: providerType,
				sessionId: opts.sessionId,
				durationMs: Date.now() - connectStartMs,
			});
			context.log.debug({ sandboxId: sandbox.sandboxId }, "Sandbox ready from snapshot");

			context.log.debug("Re-injecting environment variables");
			let envsForProfile = { ...preparedEnv.envs };
			if (preparedEnv.llmProxyBaseUrl && preparedEnv.llmProxyApiKey) {
				const { ANTHROPIC_API_KEY: _apiKey, ANTHROPIC_BASE_URL: _baseUrl, ...rest } = envsForProfile;
				envsForProfile = rest;
			}

			const envWriteStartMs = Date.now();
			await sandbox.files.write(SANDBOX_PATHS.envProfileFile, JSON.stringify(envsForProfile));
			logLatency("provider.create_sandbox.resume.env_write", {
				provider: providerType,
				sessionId: opts.sessionId,
				keyCount: Object.keys(envsForProfile).length,
				durationMs: Date.now() - envWriteStartMs,
			});

			const envExportStartMs = Date.now();
			await sandbox.commands.run(buildEnvExportCommand(), { timeoutMs: 10000 });
			logLatency("provider.create_sandbox.resume.env_export", {
				provider: providerType,
				sessionId: opts.sessionId,
				timeoutMs: 10000,
				durationMs: Date.now() - envExportStartMs,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			context.log.warn({ err }, "Snapshot resume failed, falling back to fresh sandbox");
			logLatency("provider.create_sandbox.resume.fallback", {
				provider: providerType,
				sessionId: opts.sessionId,
				error: message,
			});
			isSnapshot = false;
		}
	}

	if (!isSnapshot) {
		context.log.debug("Creating fresh sandbox (no snapshot)");
		if (!templateId) {
			throw new Error("E2B_TEMPLATE is required to create a sandbox");
		}
		const createStartMs = Date.now();
		sandbox = await Sandbox.create(templateId, sandboxOpts);
		logLatency("provider.create_sandbox.fresh.create", {
			provider: providerType,
			sessionId: opts.sessionId,
			durationMs: Date.now() - createStartMs,
		});
		context.log.debug({ sandboxId: sandbox.sandboxId }, "Sandbox created");
	}

	if (!sandbox) {
		throw new Error("Failed to initialize sandbox");
	}

	return { sandbox, isSnapshot, sandboxCreatedAt, preparedEnv };
}

export async function findRunningSandbox(
	sandboxId: string | undefined,
	getApiOpts: () => ReturnType<CreateSandboxContext["getApiOpts"]>,
): Promise<string | null> {
	if (!sandboxId) return null;

	try {
		const info = await Sandbox.getInfo(sandboxId, getApiOpts());
		return info.endAt ? null : info.sandboxId;
	} catch {
		return null;
	}
}
