import type { ServerMessage } from "@proliferate/gateway-clients";
import type {
	DaemonStreamEnvelope,
	WorkspaceStateInfo,
} from "@proliferate/shared/contracts/harness";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isWorkspaceStateInfo(value: unknown): value is WorkspaceStateInfo {
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.state !== "string") {
		return false;
	}
	return typeof value.sandboxAvailable === "boolean";
}

function toWorkspaceStateMessage(
	envelope: DaemonStreamEnvelope,
): Extract<ServerMessage, { type: "workspace_state" }> | null {
	const stream = envelope.stream as string;
	if (stream === "workspace_state" && isWorkspaceStateInfo(envelope.payload)) {
		return {
			type: "workspace_state",
			payload: envelope.payload,
		};
	}

	if (envelope.stream !== "agent_event" || envelope.event !== "data") {
		return null;
	}

	if (!isRecord(envelope.payload)) {
		return null;
	}

	const daemonEvent = envelope.payload as {
		type?: unknown;
		payload?: unknown;
	};
	if (daemonEvent.type !== "workspace.state") {
		return null;
	}
	if (!isWorkspaceStateInfo(daemonEvent.payload)) {
		return null;
	}

	return {
		type: "workspace_state",
		payload: daemonEvent.payload,
	};
}

/**
 * Keep frontend handlers stable while runtime payloads migrate.
 * We only normalize known safe mappings and otherwise pass through untouched.
 */
export function normalizeServerMessages(message: ServerMessage): ServerMessage[] {
	if (message.type !== "daemon_stream") {
		return [message];
	}

	if (!isRecord(message.payload)) {
		return [message];
	}

	const workspaceStateMessage = toWorkspaceStateMessage(message.payload as DaemonStreamEnvelope);
	if (workspaceStateMessage) {
		return [workspaceStateMessage];
	}

	return [message];
}
