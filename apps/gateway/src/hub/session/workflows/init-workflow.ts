import type { Message, ServerMessage } from "@proliferate/shared";
import { buildControlPlaneSnapshot, buildInitConfig } from "../control-plane";
import type { SessionRecord } from "../runtime/session-context-store";

interface DurableRuntimeFact {
	eventType: string;
	payloadJson: unknown;
	createdAt: Date;
}

export interface InitWorkflowDeps {
	sessionId: string;
	getRuntimeSession: () => SessionRecord;
	getFreshControlPlaneSession: (base: SessionRecord) => Promise<SessionRecord>;
	getOpenCodeUrl: () => string | null;
	getOpenCodeSessionId: () => string | null;
	getPreviewUrl: () => string | null;
	isCompletedAutomationSession: () => boolean;
	isManagerSession: () => boolean;
	collectOutputs: () => Promise<Message[]>;
	buildCompletedAutomationFallbackMessages: () => Message[];
	getDurableRuntimeFacts: () => Promise<DurableRuntimeFact[]>;
	log: (message: string, data?: Record<string, unknown>) => void;
	logError: (message: string, error?: unknown) => void;
	reconnectGeneration: number;
	mapHubStatusToControlPlaneRuntime: () =>
		| import("@proliferate/shared/contracts/sessions").SessionRuntimeStatus
		| null;
}

function summarizeFactPayload(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as Record<string, unknown>;
	const compact = {
		tool: record.tool,
		toolCallId: record.toolCallId,
		invocationId: record.invocationId,
		integration: record.integration,
		action: record.action,
		status: record.status,
		message: record.message,
	};
	const filtered = Object.fromEntries(
		Object.entries(compact).filter(([, value]) => value !== undefined),
	);
	if (Object.keys(filtered).length === 0) {
		return null;
	}
	return JSON.stringify(filtered);
}

function buildDurableFactsFallbackMessage(
	sessionId: string,
	facts: DurableRuntimeFact[],
): Message[] {
	const recent = facts.slice(-30);
	const lines = [
		"Runtime history is unavailable from the live stream, so this is a durable event fallback.",
		"Most recent runtime facts:",
	];
	for (const fact of recent) {
		const summary = summarizeFactPayload(fact.payloadJson);
		lines.push(
			`- ${fact.createdAt.toISOString()} ${fact.eventType}${summary ? ` ${summary}` : ""}`,
		);
	}
	const content = lines.join("\n");
	return [
		{
			id: `durable-facts:${sessionId}`,
			role: "assistant",
			content,
			isComplete: true,
			createdAt: Date.now(),
			parts: [{ type: "text", text: content }],
		},
	];
}

export async function buildInitMessages(
	deps: InitWorkflowDeps,
): Promise<{ initPayload: ServerMessage; snapshotPayload: ServerMessage }> {
	const contextSession = deps.getRuntimeSession();
	const snapshotSession = await deps.getFreshControlPlaneSession(contextSession);
	const openCodeUrl = deps.getOpenCodeUrl() ?? contextSession.open_code_tunnel_url ?? null;
	const openCodeSessionId =
		deps.getOpenCodeSessionId() ?? contextSession.coding_agent_session_id ?? null;
	const previewUrl = deps.getPreviewUrl() ?? contextSession.preview_tunnel_url ?? null;
	const isCompletedAutomationSession = deps.isCompletedAutomationSession();
	const durableFacts = await deps.getDurableRuntimeFacts().catch((err) => {
		deps.logError("Failed to load durable runtime facts for init fallback", err);
		return [] as DurableRuntimeFact[];
	});

	let transformed: Message[] = [];
	if (openCodeUrl && openCodeSessionId) {
		try {
			deps.log("Fetching harness outputs for init...", { openCodeSessionId });
			transformed = await deps.collectOutputs();
			deps.log("Fetched harness outputs", { messageCount: transformed.length });
		} catch (err) {
			if (!isCompletedAutomationSession && durableFacts.length === 0) {
				throw err;
			}
			deps.logError("Harness output fetch failed; using fallback transcript", err);
		}
	} else if (deps.isManagerSession()) {
		// Manager sessions have no openCodeSessionId but may have in-memory
		// accumulated messages from wake cycles. Try collectOutputs for those.
		try {
			transformed = await deps.collectOutputs();
			deps.log("Fetched manager session outputs", { messageCount: transformed.length });
		} catch {
			// Best effort — fall through to durable facts
		}
	} else if (!isCompletedAutomationSession && durableFacts.length === 0) {
		throw new Error("Missing agent session info");
	}

	if (transformed.length === 0 && durableFacts.length > 0) {
		transformed = buildDurableFactsFallbackMessage(deps.sessionId, durableFacts);
		deps.log("Using durable runtime facts fallback transcript", {
			sessionId: deps.sessionId,
			factsCount: durableFacts.length,
			messageCount: transformed.length,
		});
	}

	if (transformed.length === 0 && isCompletedAutomationSession) {
		transformed = deps.buildCompletedAutomationFallbackMessages();
		deps.log("Using completed automation fallback transcript", {
			messageCount: transformed.length,
			hasInitialPrompt: Boolean(contextSession.initial_prompt),
			hasSummary: Boolean(contextSession.summary),
			outcome: contextSession.outcome ?? null,
		});
	}

	deps.log("Sending init to client", {
		messageCount: transformed.length,
		isCompletedAutomationSession,
	});

	return {
		initPayload: {
			type: "init",
			payload: {
				messages: transformed,
				config: buildInitConfig(previewUrl),
			},
		},
		snapshotPayload: {
			type: "control_plane_snapshot",
			payload: buildControlPlaneSnapshot(
				snapshotSession,
				deps.reconnectGeneration,
				deps.mapHubStatusToControlPlaneRuntime(),
			),
		},
	};
}
