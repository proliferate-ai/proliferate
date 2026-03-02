import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../lib/session-store";
import { buildControlPlaneSnapshot, buildInitConfig } from "./control-plane";

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: "session-1",
		organization_id: "org-1",
		created_by: "user-1",
		configuration_id: null,
		session_type: "coding",
		kind: "task",
		sandbox_id: "sb-1",
		sandbox_provider: "modal",
		snapshot_id: null,
		sandbox_expires_at: null,
		branch_name: null,
		base_commit_sha: null,
		coding_agent_session_id: null,
		open_code_tunnel_url: "https://internal.example",
		preview_tunnel_url: "https://preview.example",
		agent_config: null,
		system_prompt: null,
		status: "running",
		runtime_status: "running",
		operator_status: "active",
		capabilities_version: 3,
		visibility: "shared",
		worker_id: "worker-1",
		worker_run_id: "run-1",
		pause_reason: null,
		client_type: "web",
		client_metadata: null,
		initial_prompt: null,
		initial_prompt_sent_at: null,
		outcome: null,
		summary: null,
		latest_task: null,
		...overrides,
	};
}

describe("control-plane helpers", () => {
	it("buildInitConfig omits provider tunnel config", () => {
		const config = buildInitConfig("https://preview.example");
		expect(config).toBeUndefined();
	});

	it("buildControlPlaneSnapshot returns DB/gateway control-plane state", () => {
		const snapshot = buildControlPlaneSnapshot(makeSession(), 4);
		expect(snapshot).toEqual(
			expect.objectContaining({
				sessionId: "session-1",
				runtimeStatus: "running",
				operatorStatus: "active",
				capabilitiesVersion: 3,
				visibility: "shared",
				workerId: "worker-1",
				workerRunId: "run-1",
				sandboxAvailable: true,
				reconnectSequence: 4,
				emittedAt: expect.any(String),
			}),
		);
	});

	it("marks sandbox unavailable for terminal runtime states", () => {
		const snapshot = buildControlPlaneSnapshot(
			makeSession({ sandbox_id: "sb-1", runtime_status: "failed" }),
			2,
		);
		expect(snapshot.sandboxAvailable).toBe(false);
	});

	it("prefers runtime status override for reconnect snapshots", () => {
		const snapshot = buildControlPlaneSnapshot(
			makeSession({ runtime_status: "starting", status: "running" }),
			3,
			"running",
		);
		expect(snapshot.runtimeStatus).toBe("running");
	});
});
