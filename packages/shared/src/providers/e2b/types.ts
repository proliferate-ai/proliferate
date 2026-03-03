import type { Logger } from "@proliferate/logger";
import type { Sandbox, SandboxApiOpts, SandboxConnectOpts } from "e2b";
import type { CreateSandboxOpts } from "../types";

export interface LifecycleHelpers {
	getApiOpts: () => SandboxApiOpts;
	getConnectOpts: () => SandboxConnectOpts;
	logLatency: (event: string, data?: Record<string, unknown>) => void;
}

export interface CreateSandboxContext extends LifecycleHelpers {
	providerType: "e2b";
	templateId: string | undefined;
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
