import { describe, expect, it } from "vitest";
import type { OpenCodeEvent } from "../types";
import { normalizeDaemonEvent } from "./daemon-event-bridge";

describe("normalizeDaemonEvent", () => {
	it("maps message events to message channel", () => {
		const event: OpenCodeEvent = {
			type: "message.updated",
			properties: {},
		};

		const normalized = normalizeDaemonEvent(event);
		expect(normalized.channel).toBe("message");
		expect(normalized.isTerminal).toBe(false);
		expect(normalized.payload).toBe(event);
	});

	it("keeps session.idle non-terminal", () => {
		const event: OpenCodeEvent = {
			type: "session.idle",
			properties: {},
		};

		const normalized = normalizeDaemonEvent(event);
		expect(normalized.channel).toBe("session");
		expect(normalized.isTerminal).toBe(false);
	});

	it("marks session.error as terminal", () => {
		const event: OpenCodeEvent = {
			type: "session.error",
			properties: {},
		};

		const normalized = normalizeDaemonEvent(event);
		expect(normalized.channel).toBe("session");
		expect(normalized.isTerminal).toBe(true);
	});

	it("maps server events to server channel", () => {
		const event: OpenCodeEvent = {
			type: "server.connected",
			properties: {},
		};

		const normalized = normalizeDaemonEvent(event);
		expect(normalized.channel).toBe("server");
		expect(normalized.isTerminal).toBe(false);
	});
});
