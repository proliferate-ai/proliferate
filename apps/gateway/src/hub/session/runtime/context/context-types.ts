import type { AgentConfig, RepoSpec } from "@proliferate/shared";
import type { ConfigurationServiceCommand } from "@proliferate/shared";
import type { GitIdentity } from "../git-identity";
import type { RepoRecord, SessionContext, SessionRecord } from "../session-context-store";

export interface SessionConfig {
	readonly sessionId: string;
	readonly organizationId: string;
	readonly createdBy: string | null;
	readonly kind: string | null;
	readonly sessionType: string | null;
	readonly sandboxProvider: string | null;
	readonly primaryRepo: RepoRecord;
	readonly repos: RepoSpec[];
	readonly systemPrompt: string;
	readonly agentConfig: AgentConfig & { tools?: string[] };
	readonly envVars: Record<string, string>;
	readonly gitIdentity: GitIdentity | null;
	readonly secretFileWrites: Array<{ filePath: string; content: string }>;
	readonly snapshotHasDeps: boolean;
	readonly serviceCommands?: ConfigurationServiceCommand[];
	readonly initialPrompt?: string | null;
}

export interface SessionLiveState {
	session: SessionRecord;
	openCodeUrl: string | null;
	previewUrl: string | null;
	openCodeSessionId: string | null;
	sandboxExpiresAt: number | null;
	eventStreamConnected: boolean;
}

export interface SessionRuntimeContext {
	readonly config: SessionConfig;
	live: SessionLiveState;
}

export function toLegacySessionContext(runtimeContext: SessionRuntimeContext): SessionContext {
	return {
		session: runtimeContext.live.session,
		repos: runtimeContext.config.repos,
		primaryRepo: runtimeContext.config.primaryRepo,
		systemPrompt: runtimeContext.config.systemPrompt,
		agentConfig: runtimeContext.config.agentConfig,
		gitIdentity: runtimeContext.config.gitIdentity,
		envVars: runtimeContext.config.envVars,
		secretFileWrites: runtimeContext.config.secretFileWrites,
		snapshotHasDeps: runtimeContext.config.snapshotHasDeps,
		serviceCommands: runtimeContext.config.serviceCommands,
		initialPrompt: runtimeContext.config.initialPrompt,
	};
}
