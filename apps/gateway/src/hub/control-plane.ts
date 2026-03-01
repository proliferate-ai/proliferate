import type { SessionRecord } from "../lib/session-store";

export interface ControlPlaneSnapshotPayload {
	sessionId: string;
	runtimeStatus: string | null;
	operatorStatus: string | null;
	capabilitiesVersion: number | null;
	visibility: string | null;
	workerId: string | null;
	workerRunId: string | null;
	sandboxAvailable: boolean;
	reconnectSequence: number;
	emittedAt: string;
}

export function buildInitConfig(
	previewUrl: string | null,
): { previewTunnelUrl: string } | undefined {
	if (!previewUrl) {
		return undefined;
	}
	return { previewTunnelUrl: previewUrl };
}

export function buildControlPlaneSnapshot(
	session: SessionRecord,
	reconnectSequence: number,
): ControlPlaneSnapshotPayload {
	return {
		sessionId: session.id,
		runtimeStatus: session.runtime_status ?? session.status ?? null,
		operatorStatus: session.operator_status ?? null,
		capabilitiesVersion: session.capabilities_version ?? null,
		visibility: session.visibility ?? null,
		workerId: session.worker_id ?? null,
		workerRunId: session.worker_run_id ?? null,
		sandboxAvailable: Boolean(session.sandbox_id),
		reconnectSequence,
		emittedAt: new Date().toISOString(),
	};
}
