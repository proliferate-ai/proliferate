import type { GatewayEnv } from "../../../../lib/env";
import { type SessionContext, loadSessionContext } from "../session-context-store";
import type { SessionConfig, SessionLiveState, SessionRuntimeContext } from "./context-types";

function buildSessionConfig(context: SessionContext): SessionConfig {
	return {
		sessionId: context.session.id,
		organizationId: context.session.organization_id,
		createdBy: context.session.created_by,
		kind: context.session.kind ?? null,
		sessionType: context.session.session_type,
		sandboxProvider: context.session.sandbox_provider,
		primaryRepo: context.primaryRepo,
		repos: context.repos,
		systemPrompt: context.systemPrompt,
		agentConfig: context.agentConfig,
		gitIdentity: context.gitIdentity,
		envVars: context.envVars,
		secretFileWrites: context.secretFileWrites,
		snapshotHasDeps: context.snapshotHasDeps,
		serviceCommands: context.serviceCommands,
		initialPrompt: context.initialPrompt,
	};
}

function buildSessionLiveState(context: SessionContext): SessionLiveState {
	const parsedExpiresAt = context.session.sandbox_expires_at
		? Date.parse(context.session.sandbox_expires_at)
		: null;
	return {
		session: context.session,
		openCodeUrl: context.session.open_code_tunnel_url ?? null,
		previewUrl: context.session.preview_tunnel_url ?? null,
		openCodeSessionId: context.session.coding_agent_session_id ?? null,
		sandboxExpiresAt:
			typeof parsedExpiresAt === "number" && Number.isFinite(parsedExpiresAt)
				? parsedExpiresAt
				: null,
		eventStreamConnected: false,
	};
}

export function splitSessionContext(context: SessionContext): SessionRuntimeContext {
	return {
		config: buildSessionConfig(context),
		live: buildSessionLiveState(context),
	};
}

export async function loadSessionRuntimeContext(
	env: GatewayEnv,
	sessionId: string,
): Promise<SessionRuntimeContext> {
	const context = await loadSessionContext(env, sessionId);
	return splitSessionContext(context);
}
