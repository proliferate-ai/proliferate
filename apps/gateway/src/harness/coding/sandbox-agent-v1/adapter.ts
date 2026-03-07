import type {
	DaemonStreamEnvelope,
	RuntimeDaemonEvent,
} from "@proliferate/shared/contracts/harness";
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
	createRuntimeSession,
	fetchRuntimeMessages,
	getRuntimeSession,
	interruptRuntimeSession,
	listRuntimeSessions,
	logRuntimeLookupError,
	mapRuntimeMessages,
	sendRuntimePrompt,
} from "./client";

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

function toRuntimeDaemonEvent(
	event: DaemonStreamEnvelope,
	bindingId: string,
): RuntimeDaemonEvent | null {
	if (event.stream !== "agent_event" || event.event !== "data") {
		return null;
	}
	const payload = event.payload;
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const candidate = payload as RuntimeDaemonEvent;
	if (
		typeof candidate.type !== "string" ||
		typeof candidate.channel !== "string" ||
		typeof candidate.source !== "string"
	) {
		return null;
	}
	return {
		...candidate,
		bindingId,
		sourceSeq: event.seq,
		sourceEventKey: `${bindingId}:${event.seq}`,
		occurredAt:
			typeof candidate.occurredAt === "string" && candidate.occurredAt.length > 0
				? candidate.occurredAt
				: new Date(event.ts).toISOString(),
	};
}

export class SandboxAgentV1CodingHarnessAdapter implements CodingHarnessAdapter {
	readonly name = "sandbox-agent-v1-opencode";

	async start(input: CodingHarnessStartInput): Promise<CodingHarnessStartResult> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		const sessionId = await createRuntimeSession(input.baseUrl, input.authToken, input.title);
		return { sessionId };
	}

	async resume(input: CodingHarnessResumeInput): Promise<CodingHarnessResumeResult> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		if (input.sessionId) {
			try {
				const exists = await getRuntimeSession(input.baseUrl, input.authToken, input.sessionId);
				if (exists) {
					return { sessionId: input.sessionId, mode: "reused" };
				}
			} catch (error) {
				logRuntimeLookupError(error, { mode: "get", hasSessionId: true });
				return { sessionId: input.sessionId, mode: "reused" };
			}
		}

		const listed = await listRuntimeSessions(input.baseUrl, input.authToken);
		if (listed.length > 0) {
			const newest = listed.reduce((latest, current) => {
				const latestUpdated = latest.time?.updated ?? latest.time?.created ?? 0;
				const currentUpdated = current.time?.updated ?? current.time?.created ?? 0;
				return currentUpdated >= latestUpdated ? current : latest;
			});
			return { sessionId: newest.id, mode: "adopted" };
		}

		const created = await this.start({
			baseUrl: input.baseUrl,
			authToken: input.authToken,
			title: input.title,
		});
		return { sessionId: created.sessionId, mode: "created" };
	}

	async sendPrompt(input: CodingHarnessSendPromptInput): Promise<void> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		await sendRuntimePrompt(
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
		await interruptRuntimeSession(input.baseUrl, input.authToken, input.sessionId);
	}

	async shutdown(input: CodingHarnessShutdownInput): Promise<void> {
		await this.interrupt(input);
	}

	async streamEvents(input: CodingHarnessStreamInput): Promise<CodingHarnessEventStreamHandle> {
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
				input.onDaemonEnvelope?.(event);
				const runtimeEvent = toRuntimeDaemonEvent(event, input.bindingId);
				if (!runtimeEvent) {
					return;
				}
				input.onEvent(runtimeEvent);
			},
		});

		await sseClient.connect(input.baseUrl);
		return {
			disconnect: () => sseClient.disconnect(),
		};
	}

	async collectOutputs(
		input: CodingHarnessCollectOutputsInput,
	): Promise<CodingHarnessCollectOutputsResult> {
		if (!input.authToken) {
			throw new Error("Missing sandbox runtime auth token");
		}
		const rawMessages = await fetchRuntimeMessages(input.baseUrl, input.authToken, input.sessionId);
		return { messages: mapRuntimeMessages(rawMessages) };
	}
}
