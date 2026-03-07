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
import { type UniversalEvent, mapUniversalEvent } from "./event-mapper";

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

export class SandboxAgentV2CodingHarnessAdapter implements CodingHarnessAdapter {
	readonly name = "sandbox-agent-v2-acp";

	async start(input: CodingHarnessStartInput): Promise<CodingHarnessStartResult> {
		const serverId = generateServerId();
		// createAcpSession returns the agent-internal session ID, but for coding
		// sessions we use the serverId as the binding identifier.
		await createAcpSession(input.baseUrl, serverId, DEFAULT_AGENT);
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
		await sendAcpPrompt(input.baseUrl, input.sessionId, input.content, undefined, input.images);
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
		// SSE 1: ACP agent event stream (UniversalEvents)
		// GET /v1/acp/{serverId}
		// ------------------------------------------------------------------
		const acpSessionId = input.bindingId;
		const acpSseClient = new SseClient<UniversalEvent>({
			env: input.env,
			logger: input.logger.child({ stream: "acp" }),
			// SseClient appends eventPath to the base URL
			eventPath: `/v1/acp/${encodeURIComponent(acpSessionId)}`,
			headers: {
				Accept: "text/event-stream",
			},
			parseEventData: (data) => JSON.parse(data) as UniversalEvent,
			logSummary: (event) => ({
				type: "acp.event",
				eventType: event.type,
				eventId: event.event_id,
				sequence: event.sequence,
			}),
			onDisconnect: input.onDisconnect,
			onEvent: (event) => {
				const runtimeEvent = mapUniversalEvent(event, input.bindingId);
				if (!runtimeEvent) {
					return;
				}
				input.onEvent(runtimeEvent);
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

		// Retry platform SSE connection — daemon may still be starting
		for (let attempt = 1; attempt <= 10; attempt++) {
			try {
				await platformSseClient.connect(input.baseUrl);
				break;
			} catch (err) {
				const status = err instanceof Error ? err.message : "";
				if (attempt < 10 && /50[23]/.test(status)) {
					input.logger.debug({ attempt }, "Platform SSE not ready, retrying");
					await new Promise((r) => setTimeout(r, 1000));
					continue;
				}
				throw err;
			}
		}
		disconnectors.push(() => platformSseClient.disconnect());

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
