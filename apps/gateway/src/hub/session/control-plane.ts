import type { ControlPlaneSnapshotMessage } from "@proliferate/shared";
import type {
	SessionOperatorStatus,
	SessionRuntimeStatus,
} from "@proliferate/shared/contracts/sessions";
import type { SessionRecord } from "./runtime/session-context-store";

export type ControlPlaneSnapshotPayload = ControlPlaneSnapshotMessage["payload"];

export function buildInitConfig(
	previewUrl: string | null,
): { previewTunnelUrl: string } | undefined {
	if (!previewUrl) return undefined;
	return { previewTunnelUrl: previewUrl };
}

/**
 * Derive legacy runtimeStatus from V2 columns for backward compat.
 */
function deriveRuntimeStatus(session: SessionRecord): SessionRuntimeStatus | null {
	const sandboxState = session.sandbox_state;
	const terminalState = session.terminal_state;

	if (terminalState === "succeeded") return "completed";
	if (terminalState === "failed") return "failed";
	if (terminalState === "cancelled") return "cancelled";
	if (sandboxState === "paused") return "paused";
	if (sandboxState === "running") return "running";
	if (sandboxState === "provisioning") return "starting";
	return session.runtime_status ?? null;
}

/**
 * Derive legacy operatorStatus from V2 columns for backward compat.
 */
function deriveOperatorStatus(session: SessionRecord): SessionOperatorStatus | null {
	const agentState = session.agent_state;
	const terminalState = session.terminal_state;

	if (terminalState === "succeeded" || terminalState === "cancelled") return "ready_for_review";
	if (terminalState === "failed" || agentState === "errored") return "errored";
	if (agentState === "waiting_approval") return "waiting_for_approval";
	if (agentState === "waiting_input") return "needs_input";
	if (agentState === "done") return "done";
	if (agentState === "iterating") return "active";
	return session.operator_status ?? null;
}

export function buildControlPlaneSnapshot(
	session: SessionRecord,
	reconnectSequence: number,
	runtimeStatusOverride?: SessionRuntimeStatus | null,
): ControlPlaneSnapshotPayload {
	const runtimeStatus: SessionRuntimeStatus | null =
		runtimeStatusOverride ?? deriveRuntimeStatus(session);
	const operatorStatus = deriveOperatorStatus(session);
	const unavailableStatuses = new Set(["stopped", "error", "failed", "completed", "cancelled"]);

	return {
		sessionId: session.id,
		runtimeStatus,
		operatorStatus,
		capabilitiesVersion: session.capabilities_version ?? null,
		visibility: session.visibility ?? null,
		workerId: session.worker_id ?? null,
		workerRunId: session.worker_run_id ?? null,
		sandboxAvailable: Boolean(session.sandbox_id) && !unavailableStatuses.has(runtimeStatus ?? ""),
		reconnectSequence,
		emittedAt: new Date().toISOString(),
	};
}
