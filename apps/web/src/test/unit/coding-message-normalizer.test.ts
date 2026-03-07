import { normalizeServerMessages } from "@/lib/sessions/coding-message-normalizer";
import type { ServerMessage } from "@proliferate/gateway-clients";
import { describe, expect, it } from "vitest";

describe("normalizeServerMessages", () => {
	it("passes through non-daemon messages", () => {
		const message: ServerMessage = {
			type: "status",
			payload: { status: "running", message: "ok" },
		};
		expect(normalizeServerMessages(message)).toEqual([message]);
	});

	it("maps daemon workspace.state events to workspace_state", () => {
		const daemonMessage: ServerMessage = {
			type: "daemon_stream",
			payload: {
				v: "1",
				stream: "agent_event",
				seq: 1,
				event: "data",
				payload: {
					type: "workspace.state",
					payload: {
						state: "running",
						sandboxAvailable: true,
					},
				},
				ts: Date.now(),
			},
		};

		expect(normalizeServerMessages(daemonMessage)).toEqual([
			{
				type: "workspace_state",
				payload: {
					state: "running",
					sandboxAvailable: true,
				},
			},
		]);
	});

	it("keeps unknown daemon events untouched", () => {
		const daemonMessage: ServerMessage = {
			type: "daemon_stream",
			payload: {
				v: "1",
				stream: "agent_event",
				seq: 2,
				event: "data",
				payload: { type: "session.status", payload: { status: { type: "busy" } } },
				ts: Date.now(),
			},
		};

		expect(normalizeServerMessages(daemonMessage)).toEqual([daemonMessage]);
	});
});
