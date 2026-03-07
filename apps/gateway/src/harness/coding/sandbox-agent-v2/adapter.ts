/**
 * Sandbox Agent v2 coding harness adapter.
 *
 * Uses the ACP (Agent Client Protocol) to manage agent sessions
 * through the Rivet Sandbox Agent. Replaces the v1 adapter that
 * communicated with the sandbox-daemon's OpenCode bridge.
 *
 * SSE events come from GET /v1/acp/{serverId} as UniversalEvents,
 * which are mapped to RuntimeDaemonEvent for the gateway EventProcessor.
 */

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
	type AcpAgent,
	createAcpServer,
	deleteAcpServer,
	sendAcpEnvelope,
} from "./client";
import {
	type UniversalEvent,
	mapUniversalEventToRuntimeDaemonEvent,
} from "./event-mapper";

/**
 * Adapter for coding sessions via Sandbox Agent ACP protocol.
 * Each coding session maps to one ACP server (agent process).
 */
export class SandboxAgentV2CodingHarnessAdapter implements CodingHarnessAdapter {
	readonly name = "sandbox-agent-v2";
	private readonly agent: AcpAgent;
	/** ACP server ID for the current session, used for SSE endpoint path. */
	private currentServerId: string | null = null;

	constructor(agent: AcpAgent = "claude") {
		this.agent = agent;
	}

	async start(input: CodingHarnessStartInput): Promise<CodingHarnessStartResult> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		const { serverId } = await createAcpServer(input.baseUrl, input.authToken, this.agent);
		this.currentServerId = serverId;
		return { sessionId: serverId };
	}

	async resume(input: CodingHarnessResumeInput): Promise<CodingHarnessResumeResult> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		// If we have an existing session ID, assume it's still valid
		// (Sandbox Agent manages agent process lifecycle)
		if (input.sessionId) {
			this.currentServerId = input.sessionId;
			return { sessionId: input.sessionId, mode: "reused" };
		}
		// No existing session — create a new one
		const { serverId } = await createAcpServer(input.baseUrl, input.authToken, this.agent);
		this.currentServerId = serverId;
		return { sessionId: serverId, mode: "created" };
	}

	async sendPrompt(input: CodingHarnessSendPromptInput): Promise<void> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		await sendAcpEnvelope(
			input.baseUrl,
			input.authToken,
			input.sessionId,
			input.content,
			input.images,
		);
	}

	async interrupt(input: CodingHarnessInterruptInput): Promise<void> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		// ACP interrupt: delete the server to stop the agent
		await deleteAcpServer(input.baseUrl, input.authToken, input.sessionId);
	}

	async shutdown(input: CodingHarnessShutdownInput): Promise<void> {
		if (!input.authToken) {
			return;
		}
		await deleteAcpServer(input.baseUrl, input.authToken, input.sessionId).catch(() => {
			// Best effort — server may already be gone
		});
	}

	async streamEvents(input: CodingHarnessStreamInput): Promise<CodingHarnessEventStreamHandle> {
		// Connect to the daemon's platform SSE for port/fs events
		const daemonSse = await this.connectDaemonStream(input);
		// Connect to the Sandbox Agent's ACP SSE for agent events
		const agentSse = await this.connectAgentStream(input);

		return {
			disconnect: () => {
				daemonSse.disconnect();
				agentSse.disconnect();
			},
		};
	}

	async collectOutputs(
		_input: CodingHarnessCollectOutputsInput,
	): Promise<CodingHarnessCollectOutputsResult> {
		// ACP state endpoint would go here; for now return empty
		return { messages: [] };
	}

	// -----------------------------------------------------------------------
	// Internal: Daemon platform SSE (port events, fs changes, pty output)
	// -----------------------------------------------------------------------

	private async connectDaemonStream(
		input: CodingHarnessStreamInput,
	): Promise<{ disconnect: () => void }> {
		interface DaemonInitEvent {
			type: "init";
			seq: number;
			ports?: unknown;
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

		const afterSeqQuery =
			typeof input.afterSeq === "number" && input.afterSeq > 0
				? `?last_seq=${encodeURIComponent(String(input.afterSeq))}`
				: "";
		const eventPath = `/_proliferate/events${afterSeqQuery}`;

		const sseClient = new SseClient<DaemonSseEvent>({
			env: input.env,
			logger: input.logger,
			eventPath,
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
			onDisconnect: input.onDisconnect,
			onEvent: (event) => {
				if (!isDaemonEnvelope(event)) {
					return;
				}
				// Forward platform envelopes (port_opened, fs_change, etc.)
				input.onDaemonEnvelope?.(event);
			},
		});

		await sseClient.connect(input.baseUrl);
		return { disconnect: () => sseClient.disconnect() };
	}

	// -----------------------------------------------------------------------
	// Internal: Sandbox Agent ACP SSE (agent events)
	// -----------------------------------------------------------------------

	private async connectAgentStream(
		input: CodingHarnessStreamInput,
	): Promise<{ disconnect: () => void }> {
		if (!this.currentServerId) {
			throw new Error("No ACP server ID — call start() or resume() first");
		}
		// The ACP SSE endpoint is at /v1/acp/{serverId}
		// Proxied through Caddy on port 20000
		const eventPath = `/v1/acp/${encodeURIComponent(this.currentServerId)}`;

		const sseClient = new SseClient<UniversalEvent>({
			env: input.env,
			logger: input.logger,
			eventPath,
			headers: input.authToken ? { Authorization: `Bearer ${input.authToken}` } : undefined,
			parseEventData: (data) => JSON.parse(data) as UniversalEvent,
			logSummary: (event) => ({
				type: `acp.${event.event_type}`,
				seq: event.sequence,
				sessionId: event.session_id,
			}),
			onDisconnect: input.onDisconnect,
			onEvent: (event) => {
				const runtimeEvent = mapUniversalEventToRuntimeDaemonEvent(event, input.bindingId);
				if (runtimeEvent) {
					input.onEvent(runtimeEvent);
				}
			},
		});

		await sseClient.connect(input.baseUrl);
		return { disconnect: () => sseClient.disconnect() };
	}
}
