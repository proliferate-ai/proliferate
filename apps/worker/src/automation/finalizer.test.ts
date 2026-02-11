import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalizerDeps, FinalizerRun, SessionStatus } from "./finalizer";
import { finalizeOneRun } from "./finalizer";

function makeRun(overrides: Partial<FinalizerRun> = {}): FinalizerRun {
	return {
		id: "id" in overrides ? overrides.id! : "run-1",
		organizationId: "organizationId" in overrides ? overrides.organizationId! : "org-1",
		sessionId: "sessionId" in overrides ? (overrides.sessionId as string | null) : "session-1",
		triggerEventId: "triggerEventId" in overrides ? overrides.triggerEventId! : "event-1",
		deadlineAt: "deadlineAt" in overrides ? (overrides.deadlineAt as Date | null) : null,
		completionId: "completionId" in overrides ? (overrides.completionId as string | null) : null,
	};
}

function makeDeps(statusResponse?: SessionStatus | Error): FinalizerDeps & {
	getSessionStatus: ReturnType<typeof vi.fn>;
	markRunFailed: ReturnType<typeof vi.fn>;
	transitionRunStatus: ReturnType<typeof vi.fn>;
	updateTriggerEvent: ReturnType<typeof vi.fn>;
	enqueueNotification: ReturnType<typeof vi.fn>;
} {
	const getSessionStatus =
		statusResponse instanceof Error
			? vi.fn().mockRejectedValue(statusResponse)
			: vi.fn().mockResolvedValue(statusResponse ?? { state: "running", status: "running" });

	return {
		getSessionStatus,
		markRunFailed: vi.fn().mockResolvedValue(null),
		transitionRunStatus: vi.fn().mockResolvedValue(null),
		updateTriggerEvent: vi.fn().mockResolvedValue(undefined),
		enqueueNotification: vi.fn().mockResolvedValue(undefined),
		log: {
			info: vi.fn(),
			warn: vi.fn(),
		},
	};
}

describe("finalizeOneRun", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fails run with missing_session when no sessionId", async () => {
		const run = makeRun({ sessionId: null });
		const deps = makeDeps();

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "missing_session",
			stage: "finalizer",
			errorMessage: "Run has no session",
		});
		expect(deps.updateTriggerEvent).toHaveBeenCalledWith("event-1", {
			status: "failed",
			errorMessage: "Run has no session",
			processedAt: expect.any(Date),
		});
		expect(deps.getSessionStatus).not.toHaveBeenCalled();
	});

	it("times out run when deadline is exceeded", async () => {
		const run = makeRun({ deadlineAt: new Date(Date.now() - 60_000) });
		const deps = makeDeps();

		await finalizeOneRun(run, deps);

		expect(deps.transitionRunStatus).toHaveBeenCalledWith("run-1", "timed_out", {
			statusReason: "deadline_exceeded",
			failureStage: "finalizer",
			completedAt: expect.any(Date),
		});
		expect(deps.updateTriggerEvent).toHaveBeenCalledWith("event-1", {
			status: "failed",
			errorMessage: "Run timed out (deadline exceeded)",
			processedAt: expect.any(Date),
		});
		expect(deps.getSessionStatus).not.toHaveBeenCalled();
	});

	it("does not time out when deadline is in the future", async () => {
		const run = makeRun({ deadlineAt: new Date(Date.now() + 60_000) });
		const deps = makeDeps({ state: "running", status: "running", sandboxAlive: true });

		await finalizeOneRun(run, deps);

		expect(deps.transitionRunStatus).not.toHaveBeenCalled();
		expect(deps.markRunFailed).not.toHaveBeenCalled();
	});

	it("fails run with sandbox_dead when sandbox is not alive", async () => {
		const run = makeRun();
		const deps = makeDeps({
			state: "running",
			status: "running",
			sandboxId: "sb-123",
			sandboxAlive: false,
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "sandbox_dead",
			stage: "finalizer",
			errorMessage: "Sandbox sb-123 is no longer running at the provider",
		});
		expect(deps.updateTriggerEvent).toHaveBeenCalledWith("event-1", {
			status: "failed",
			errorMessage: "Sandbox sb-123 is no longer running at the provider",
			processedAt: expect.any(Date),
		});
	});

	it("fails with no_completion when session terminated without completion", async () => {
		const run = makeRun({ completionId: null });
		const deps = makeDeps({
			state: "terminated",
			status: "stopped",
			reason: "timeout",
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "no_completion",
			stage: "finalizer",
			errorMessage: "Session terminated (timeout) without calling automation.complete",
		});
	});

	it("fails with no_completion (no reason) when session terminated without reason", async () => {
		const run = makeRun({ completionId: null });
		const deps = makeDeps({
			state: "terminated",
			status: "stopped",
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).toHaveBeenCalledWith({
			runId: "run-1",
			reason: "no_completion",
			stage: "finalizer",
			errorMessage: "Session terminated without calling automation.complete",
		});
	});

	it("skips when session terminated but completion already recorded", async () => {
		const run = makeRun({ completionId: "run:run-1:completion:v1" });
		const deps = makeDeps({
			state: "terminated",
			status: "stopped",
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).not.toHaveBeenCalled();
		expect(deps.transitionRunStatus).not.toHaveBeenCalled();
	});

	it("leaves run alone when session is running and sandbox is alive", async () => {
		const run = makeRun();
		const deps = makeDeps({
			state: "running",
			status: "running",
			sandboxId: "sb-123",
			sandboxAlive: true,
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).not.toHaveBeenCalled();
		expect(deps.transitionRunStatus).not.toHaveBeenCalled();
		expect(deps.updateTriggerEvent).not.toHaveBeenCalled();
	});

	it("leaves run alone when session is running and sandbox liveness is unknown (null)", async () => {
		const run = makeRun();
		const deps = makeDeps({
			state: "running",
			status: "running",
			sandboxAlive: null,
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).not.toHaveBeenCalled();
		expect(deps.transitionRunStatus).not.toHaveBeenCalled();
	});

	it("leaves run alone when sandboxAlive is not present in response", async () => {
		const run = makeRun();
		const deps = makeDeps({
			state: "running",
			status: "running",
		});

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).not.toHaveBeenCalled();
		expect(deps.transitionRunStatus).not.toHaveBeenCalled();
	});

	it("skips run when gateway is unreachable", async () => {
		const run = makeRun();
		const deps = makeDeps(new Error("ECONNREFUSED"));

		await finalizeOneRun(run, deps);

		expect(deps.markRunFailed).not.toHaveBeenCalled();
		expect(deps.transitionRunStatus).not.toHaveBeenCalled();
		expect(deps.log.warn).toHaveBeenCalledWith(
			expect.objectContaining({ runId: "run-1" }),
			"Session status check failed, will retry",
		);
	});

	it("enqueues timed_out notification on deadline exceeded", async () => {
		const run = makeRun({ deadlineAt: new Date(Date.now() - 60_000) });
		const deps = makeDeps();

		await finalizeOneRun(run, deps);

		expect(deps.enqueueNotification).toHaveBeenCalledWith("org-1", "run-1", "timed_out");
	});

	it("does not break when notification enqueue fails on timeout", async () => {
		const run = makeRun({ deadlineAt: new Date(Date.now() - 60_000) });
		const deps = makeDeps();
		deps.enqueueNotification.mockRejectedValue(new Error("outbox write failed"));

		await finalizeOneRun(run, deps);

		expect(deps.transitionRunStatus).toHaveBeenCalledWith("run-1", "timed_out", expect.any(Object));
		expect(deps.enqueueNotification).toHaveBeenCalled();
	});

	it("checks deadline before session status", async () => {
		const run = makeRun({ deadlineAt: new Date(Date.now() - 1000) });
		const deps = makeDeps({
			state: "running",
			status: "running",
			sandboxAlive: true,
		});

		await finalizeOneRun(run, deps);

		expect(deps.transitionRunStatus).toHaveBeenCalledWith("run-1", "timed_out", expect.any(Object));
		expect(deps.getSessionStatus).not.toHaveBeenCalled();
	});
});
