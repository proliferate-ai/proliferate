import type { SessionLiveState } from "./session-live-state";

export function reconcileRuntimePointers(
	live: SessionLiveState,
	values: {
		openCodeUrl?: string | null;
		previewUrl?: string | null;
		openCodeSessionId?: string | null;
		sandboxId?: string | null;
		sandboxExpiresAt?: number | null;
	},
): void {
	if (values.openCodeUrl !== undefined) {
		live.openCodeUrl = values.openCodeUrl;
		live.session.open_code_tunnel_url = values.openCodeUrl;
	}
	if (values.previewUrl !== undefined) {
		live.previewUrl = values.previewUrl;
		live.session.preview_tunnel_url = values.previewUrl;
	}
	if (values.openCodeSessionId !== undefined) {
		live.openCodeSessionId = values.openCodeSessionId;
		live.session.coding_agent_session_id = values.openCodeSessionId;
	}
	if (values.sandboxId !== undefined) {
		live.session.sandbox_id = values.sandboxId;
	}
	if (values.sandboxExpiresAt !== undefined) {
		live.sandboxExpiresAt = values.sandboxExpiresAt;
		live.session.sandbox_expires_at = values.sandboxExpiresAt
			? new Date(values.sandboxExpiresAt).toISOString()
			: null;
	}
}

export function clearRuntimePointers(live: SessionLiveState): void {
	reconcileRuntimePointers(live, {
		openCodeUrl: null,
		previewUrl: null,
		openCodeSessionId: null,
		sandboxId: null,
		sandboxExpiresAt: null,
	});
	live.eventStreamConnected = false;
}
