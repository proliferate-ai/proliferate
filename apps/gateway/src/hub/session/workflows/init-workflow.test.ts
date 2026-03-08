import type { Message } from "@proliferate/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../runtime/session-context-store";
import { type InitWorkflowDeps, buildInitMessages } from "./init-workflow";

function createSessionRecord(): SessionRecord {
	return {
		id: "session-1",
		runtime_status: "running",
		operator_status: "active",
		capabilities_version: 1,
		visibility: "private",
		worker_id: null,
		worker_run_id: null,
		sandbox_id: "sandbox-1",
	} as SessionRecord;
}

function createDeps(overrides: Partial<InitWorkflowDeps> = {}): InitWorkflowDeps {
	const baseSession = createSessionRecord();
	return {
		sessionId: baseSession.id,
		getRuntimeSession: () => baseSession,
		getFreshControlPlaneSession: async () => baseSession,
		getOpenCodeUrl: () => "http://runtime",
		getOpenCodeSessionId: () => "coding-session",
		getPreviewUrl: () => "http://preview",
		isCompletedAutomationSession: () => false,
		isManagerSession: () => false,
		collectOutputs: async () =>
			[
				{
					id: "m1",
					role: "assistant",
					content: "ok",
					isComplete: true,
					createdAt: Date.now(),
				},
			] satisfies Message[],
		buildCompletedAutomationFallbackMessages: () => [],
		getDurableRuntimeFacts: async () => [],
		log: vi.fn(),
		logError: vi.fn(),
		reconnectGeneration: 1,
		mapHubStatusToControlPlaneRuntime: () => "running",
		...overrides,
	};
}

describe("buildInitMessages", () => {
	it("uses durable runtime facts fallback when runtime outputs are unavailable", async () => {
		const result = await buildInitMessages(
			createDeps({
				getOpenCodeUrl: () => null,
				getOpenCodeSessionId: () => null,
				getDurableRuntimeFacts: async () => [
					{
						eventType: "runtime_error",
						payloadJson: { message: "runtime disconnected" },
						createdAt: new Date("2026-03-01T00:00:00.000Z"),
					},
				],
			}),
		);

		expect(result.initPayload.type).toBe("init");
		if (result.initPayload.type !== "init") {
			throw new Error("Expected init payload");
		}
		const payload = result.initPayload.payload;
		expect(payload.messages).toHaveLength(1);
		expect(payload.messages[0]?.content).toContain("durable event fallback");
		expect(payload.messages[0]?.content).toContain("runtime_error");
	});

	it("falls back to durable facts when collectOutputs fails", async () => {
		const result = await buildInitMessages(
			createDeps({
				collectOutputs: async () => {
					throw new Error("runtime fetch failed");
				},
				getDurableRuntimeFacts: async () => [
					{
						eventType: "runtime_tool_finished",
						payloadJson: { tool: "bash", status: "completed" },
						createdAt: new Date("2026-03-01T00:00:00.000Z"),
					},
				],
			}),
		);

		expect(result.initPayload.type).toBe("init");
		if (result.initPayload.type !== "init") {
			throw new Error("Expected init payload");
		}
		const payload = result.initPayload.payload;
		expect(payload.messages).toHaveLength(1);
		expect(payload.messages[0]?.content).toContain("runtime_tool_finished");
	});
});
