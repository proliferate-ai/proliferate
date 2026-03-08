import type { DaemonStreamEnvelope } from "@proliferate/shared/contracts/harness";
import { SseClient } from "../../../hub/session/runtime/sse-client";
import type {
	CodingHarnessAdapter,
	CodingHarnessCollectOutputsInput,
	CodingHarnessCollectOutputsResult,
	CodingHarnessEventStreamHandle,
	CodingHarnessInterruptInput,
	CodingHarnessResumeInput,
	CodingHarnessResumeResult,
	CodingHarnessSendPromptInput,
	CodingHarnessShutdownInput,
	CodingHarnessStartInput,
	CodingHarnessStartResult,
	CodingHarnessStreamInput,
} from "../../contracts/coding";
import {
	closeAcpSession,
	createAcpSession,
	interruptAcpSession,
	listAcpSessions,
	logAcpLookupError,
	sendAcpPrompt,
	waitForAcpReady,
} from "./client";
import { type AcpJsonRpcEvent, mapAcpJsonRpcEvent } from "./event-mapper";

// ---------------------------------------------------------------------------
// Daemon SSE envelope (platform events from /_proliferate/events)
// ---------------------------------------------------------------------------

interface DaemonInitEvent {
	type: "init";
	seq: number;
	ports?: unknown;
	opencode?: boolean;
}

type DaemonSseEvent = DaemonInitEvent | DaemonStreamEnvelope;

function isDaemonEnvelope(value: DaemonSseEvent): value is DaemonStreamEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		"stream" in value &&
		"seq" in value &&
		"event" in value
	);
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const DEFAULT_AGENT = "opencode";

/**
 * Module-level map from ACP serverId → agent-internal session ID.
 * Populated during start/resume/streamEvents. Needed because the
 * CodingHarnessAdapter contract only passes a single "sessionId"
 * which we use as the ACP serverId (URL path), while the agent's
 * internal session ID is different and required for JSON-RPC params.
 */
const agentSessionIds = new Map<string, string>();

export class SandboxAgentV2CodingHarnessAdapter implements CodingHarnessAdapter {
	readonly name = "sandbox-agent-v2-acp";

	async start(input: CodingHarnessStartInput): Promise<CodingHarnessStartResult> {
		const serverId = generateServerId();
		const agentSessionId = await createAcpSession(input.baseUrl, serverId, DEFAULT_AGENT);
		agentSessionIds.set(serverId, agentSessionId);
		return { sessionId: serverId };
	}

	async resume(input: CodingHarnessResumeInput): Promise<CodingHarnessResumeResult> {
		// Wait for sandbox-agent to be ready (it starts async during bootstrap)
		await waitForAcpReady(input.baseUrl);

		// If we have a known serverId, try to reuse it
		if (input.sessionId) {
			try {
				const sessions = await listAcpSessions(input.baseUrl);
				const exists = sessions.some((s) => s.serverId === input.sessionId);
				if (exists) {
					return { sessionId: input.sessionId, mode: "reused" };
				}
			} catch (error) {
				logAcpLookupError(error, { mode: "list", hasSessionId: true });
				// On lookup failure, optimistically reuse
				return { sessionId: input.sessionId, mode: "reused" };
			}
		}

		// Check for any existing sessions to adopt
		try {
			const sessions = await listAcpSessions(input.baseUrl);
			if (sessions.length > 0) {
				return { sessionId: sessions[0].serverId, mode: "adopted" };
			}
		} catch (error) {
			logAcpLookupError(error, { mode: "list", hasSessionId: false });
		}

		// No existing session found, create a new one
		const created = await this.start({
			baseUrl: input.baseUrl,
			authToken: input.authToken,
			title: input.title,
		});
		return { sessionId: created.sessionId, mode: "created" };
	}

	async sendPrompt(input: CodingHarnessSendPromptInput): Promise<void> {
		const agentSessionId = agentSessionIds.get(input.sessionId);
		await sendAcpPrompt(
			input.baseUrl,
			input.sessionId,
			input.content,
			agentSessionId,
			input.images,
		);
	}

	async interrupt(input: CodingHarnessInterruptInput): Promise<void> {
		await interruptAcpSession(input.baseUrl, input.sessionId);
	}

	async shutdown(input: CodingHarnessShutdownInput): Promise<void> {
		await closeAcpSession(input.baseUrl, input.sessionId);
	}

	async streamEvents(input: CodingHarnessStreamInput): Promise<CodingHarnessEventStreamHandle> {
		const disconnectors: Array<() => void> = [];

		// ------------------------------------------------------------------
		// SSE 1: ACP agent event stream (JSON-RPC messages from sandbox-agent)
		// GET /v1/acp/{serverId}
		// ------------------------------------------------------------------
		const serverId = input.bindingId;
		const acpSseClient = new SseClient<AcpJsonRpcEvent>({
			env: input.env,
			logger: input.logger.child({ stream: "acp" }),
			eventPath: `/v1/acp/${encodeURIComponent(serverId)}`,
			headers: {
				Accept: "text/event-stream",
			},
			parseEventData: (data) => JSON.parse(data) as AcpJsonRpcEvent,
			logSummary: (event) => ({
				type: "acp.event",
				method: event.method ?? null,
				id: event.id ?? null,
				hasError: !!event.error,
			}),
			onDisconnect: input.onDisconnect,
			onEvent: (event) => {
				// Extract agent session ID from session/new response
				const maybeSessionId = event.result?.sessionId;
				if (event.id && typeof maybeSessionId === "string") {
					agentSessionIds.set(serverId, maybeSessionId);
					input.logger.info(
						{ serverId, agentSessionId: maybeSessionId },
						"Captured agent session ID from SSE",
					);
				}

				const runtimeResult = mapAcpJsonRpcEvent(event, serverId);
				if (!runtimeResult) {
					input.logger.debug(
						{ method: event.method ?? null, id: event.id ?? null },
						"ACP event not mapped (skipped)",
					);
					return;
				}
				const events = Array.isArray(runtimeResult) ? runtimeResult : [runtimeResult];
				for (const runtimeEvent of events) {
					input.logger.debug(
						{ channel: runtimeEvent.channel, type: runtimeEvent.type },
						"ACP event mapped → forwarding",
					);
					input.onEvent(runtimeEvent);
				}
			},
		});

		await acpSseClient.connect(input.baseUrl);
		disconnectors.push(() => acpSseClient.disconnect());

		// ------------------------------------------------------------------
		// SSE 2: Platform events (PTY, FS, ports) from /_proliferate/events
		// ------------------------------------------------------------------
		const afterSeqQuery =
			typeof input.afterSeq === "number" && input.afterSeq > 0
				? `?last_seq=${encodeURIComponent(String(input.afterSeq))}`
				: "";
		const platformEventPath = `/_proliferate/events${afterSeqQuery}`;

		const platformSseClient = new SseClient<DaemonSseEvent>({
			env: input.env,
			logger: input.logger.child({ stream: "platform" }),
			eventPath: platformEventPath,
			headers: input.authToken ? { Authorization: `Bearer ${input.authToken}` } : undefined,
			parseEventData: (data) => JSON.parse(data) as DaemonSseEvent,
			logSummary: (event) => {
				if (!isDaemonEnvelope(event)) {
					return { type: "daemon.init", seq: event.seq ?? null };
				}
				return {
					type: "daemon.event",
					stream: event.stream,
					event: event.event,
					seq: event.seq,
				};
			},
			onDisconnect: (reason) => {
				input.logger.warn({ reason }, "Platform SSE disconnected");
			},
			onEvent: (event) => {
				if (!isDaemonEnvelope(event)) {
					return;
				}
				input.onDaemonEnvelope?.(event);
			},
		});

		// Retry platform SSE connection — daemon may still be starting or
		// token refresh may be in flight after snapshot resume (401).
		// Platform SSE is non-critical: PTY/FS/port events are nice-to-have
		// but not required for the agent chat to work (ACP SSE handles that).
		let platformConnected = false;
		for (let attempt = 1; attempt <= 10; attempt++) {
			try {
				await platformSseClient.connect(input.baseUrl);
				platformConnected = true;
				break;
			} catch (err) {
				const status = err instanceof Error ? err.message : "";
				if (attempt < 10 && /40[13]|50[23]/.test(status)) {
					input.logger.debug({ attempt, status }, "Platform SSE not ready, retrying");
					await new Promise((r) => setTimeout(r, 1000));
					continue;
				}
				// Don't throw — platform SSE is optional for chat functionality
				input.logger.warn(
					{ err },
					"Platform SSE connection failed after retries, continuing without platform events",
				);
				break;
			}
		}
		if (platformConnected) {
			disconnectors.push(() => platformSseClient.disconnect());
		}

		return {
			disconnect: () => {
				for (const disconnect of disconnectors) {
					disconnect();
				}
			},
		};
	}

	async collectOutputs(
		_input: CodingHarnessCollectOutputsInput,
	): Promise<CodingHarnessCollectOutputsResult> {
		// sandbox-agent v2 does not support direct message collection;
		// the gateway relies on the event stream for all outputs.
		return { messages: [] };
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateServerId(): string {
	return crypto.randomUUID();
}
