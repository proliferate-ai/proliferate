import { SseClient } from "../hub/sse-client";
import {
	abortOpenCodeSession,
	createOpenCodeSession,
	fetchOpenCodeMessages,
	getOpenCodeSession,
	listOpenCodeSessions,
} from "../lib/opencode";
import type {
	CodingHarnessAdapter,
	CodingHarnessCollectOutputsInput,
	CodingHarnessCollectOutputsResult,
	CodingHarnessEventStreamHandle,
	CodingHarnessInterruptInput,
	CodingHarnessResumeInput,
	CodingHarnessResumeResult,
	CodingHarnessShutdownInput,
	CodingHarnessStartInput,
	CodingHarnessStartResult,
	CodingHarnessStreamInput,
} from "./coding-harness";
import { normalizeDaemonEvent } from "./daemon-event-bridge";

export class OpenCodeCodingHarnessAdapter implements CodingHarnessAdapter {
	readonly name = "opencode";

	async start(input: CodingHarnessStartInput): Promise<CodingHarnessStartResult> {
		const sessionId = await createOpenCodeSession(input.baseUrl, input.title);
		return { sessionId };
	}

	async resume(input: CodingHarnessResumeInput): Promise<CodingHarnessResumeResult> {
		if (input.sessionId) {
			try {
				const exists = await getOpenCodeSession(input.baseUrl, input.sessionId);
				if (exists) {
					return { sessionId: input.sessionId, mode: "reused" };
				}
			} catch {
				// Conservative fallback: keep existing session ID on transient lookup failures.
				return { sessionId: input.sessionId, mode: "reused" };
			}
		}

		const listed = await listOpenCodeSessions(input.baseUrl);
		if (listed.length > 0) {
			const newest = listed.reduce((latest, current) => {
				const latestUpdated = latest.time?.updated ?? latest.time?.created ?? 0;
				const currentUpdated = current.time?.updated ?? current.time?.created ?? 0;
				return currentUpdated >= latestUpdated ? current : latest;
			});
			return { sessionId: newest.id, mode: "adopted" };
		}

		const created = await this.start({ baseUrl: input.baseUrl, title: input.title });
		return { sessionId: created.sessionId, mode: "created" };
	}

	async interrupt(input: CodingHarnessInterruptInput): Promise<void> {
		await abortOpenCodeSession(input.baseUrl, input.sessionId);
	}

	async shutdown(input: CodingHarnessShutdownInput): Promise<void> {
		await this.interrupt(input);
	}

	async streamEvents(input: CodingHarnessStreamInput): Promise<CodingHarnessEventStreamHandle> {
		const sseClient = new SseClient({
			env: input.env,
			logger: input.logger,
			onDisconnect: input.onDisconnect,
			onEvent: (event) => input.onEvent(normalizeDaemonEvent(event)),
		});

		await sseClient.connect(input.baseUrl);
		return {
			disconnect: () => sseClient.disconnect(),
		};
	}

	async collectOutputs(
		input: CodingHarnessCollectOutputsInput,
	): Promise<CodingHarnessCollectOutputsResult> {
		const messages = await fetchOpenCodeMessages(input.baseUrl, input.sessionId);
		return { messages };
	}
}
