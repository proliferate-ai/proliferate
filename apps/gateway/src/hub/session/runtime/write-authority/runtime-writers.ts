import { sessions } from "@proliferate/services";
import type { SessionLiveState } from "../state/session-live-state";
import { reconcileRuntimePointers } from "../state/state-reconciler";

export async function persistRuntimeReady(input: {
	sessionId: string;
	live: SessionLiveState;
	sandboxId: string;
	openCodeTunnelUrl: string | null;
	previewTunnelUrl: string | null;
	sandboxExpiresAt: number | null;
	autoPauseSnapshotId?: string;
}): Promise<void> {
	await sessions.updateSession(input.sessionId, {
		sandboxId: input.sandboxId,
		status: "running",
		pauseReason: null,
		openCodeTunnelUrl: input.openCodeTunnelUrl,
		previewTunnelUrl: input.previewTunnelUrl,
		sandboxExpiresAt: input.sandboxExpiresAt,
		...(input.autoPauseSnapshotId ? { snapshotId: input.autoPauseSnapshotId } : {}),
	});
	reconcileRuntimePointers(input.live, {
		sandboxId: input.sandboxId,
		openCodeUrl: input.openCodeTunnelUrl,
		previewUrl: input.previewTunnelUrl,
		sandboxExpiresAt: input.sandboxExpiresAt,
	});
	if (input.autoPauseSnapshotId && !input.live.session.snapshot_id) {
		input.live.session.snapshot_id = input.autoPauseSnapshotId;
	}
}

export async function persistCodingSessionId(input: {
	sessionId: string;
	live: SessionLiveState;
	codingSessionId: string;
}): Promise<void> {
	await sessions.updateSession(input.sessionId, { codingAgentSessionId: input.codingSessionId });
	reconcileRuntimePointers(input.live, { openCodeSessionId: input.codingSessionId });
}
