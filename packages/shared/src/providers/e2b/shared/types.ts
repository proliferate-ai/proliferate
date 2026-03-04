import type { Logger } from "@proliferate/logger";
import type { Sandbox } from "e2b";
import type { CreateSandboxOpts } from "../../types";

export interface CreateSandboxContext {
	opts: CreateSandboxOpts;
	log: Logger;
}

export interface PreparedSandboxEnv {
	envs: Record<string, string>;
	llmProxyBaseUrl: string | undefined;
	llmProxyApiKey: string | undefined;
}

export interface SandboxInitializationResult {
	sandbox: Sandbox;
	isSnapshot: boolean;
	sandboxCreatedAt: number;
	preparedEnv: PreparedSandboxEnv;
}
