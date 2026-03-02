import type { ControlPlaneSnapshotMessage, SessionRuntimeStatus } from "@proliferate/shared";
import type { SessionRecord } from "../lib/session-store";

export type ControlPlaneSnapshotPayload = ControlPlaneSnapshotMessage["payload"];

export function buildInitConfig(
	previewUrl: string | null,
): { previewTunnelUrl: string } | undefined {
	if (!previewUrl) return undefined;
	return { previewTunnelUrl: previewUrl };
}

export function buildControlPlaneSnapshot(
	session: SessionRecord,
	reconnectSequence: number,
	runtimeStatusOverride?: SessionRuntimeStatus | null,
): ControlPlaneSnapshotPayload {
	const runtimeStatus: SessionRuntimeStatus | null =
		runtimeStatusOverride ?? session.runtime_status ?? null;
	const unavailableStatuses = new Set(["stopped", "error", "failed", "completed", "cancelled"]);

	return {
		sessionId: session.id,
		runtimeStatus,
		operatorStatus: session.operator_status ?? null,
		capabilitiesVersion: session.capabilities_version ?? null,
		visibility: session.visibility ?? null,
		workerId: session.worker_id ?? null,
		workerRunId: session.worker_run_id ?? null,
		sandboxAvailable: Boolean(session.sandbox_id) && !unavailableStatuses.has(runtimeStatus ?? ""),
		reconnectSequence,
		emittedAt: new Date().toISOString(),
	};
}
