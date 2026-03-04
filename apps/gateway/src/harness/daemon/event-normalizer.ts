import type { OpenCodeEvent } from "../../types";
import type { RuntimeDaemonEvent } from "../contracts/coding";

function resolveChannel(eventType: string): RuntimeDaemonEvent["channel"] {
	if (eventType.startsWith("message.")) {
		return "message";
	}
	if (eventType.startsWith("session.")) {
		return "session";
	}
	return "server";
}

function isTerminalEvent(eventType: string): boolean {
	return eventType === "session.error";
}

export function normalizeDaemonEvent(event: OpenCodeEvent): RuntimeDaemonEvent {
	return {
		source: "daemon",
		channel: resolveChannel(event.type),
		type: event.type,
		isTerminal: isTerminalEvent(event.type),
		occurredAt: new Date().toISOString(),
		payload: event,
	};
}
