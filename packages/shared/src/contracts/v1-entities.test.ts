import { describe, expect, it } from "vitest";
import {
	// Action invocation
	ACTIVE_RESUME_INTENT_STATUSES,
	NON_TERMINAL_SESSION_RUNTIME_STATUSES,
	NON_TERMINAL_WORKER_RUN_STATUSES,
	// Repo baseline
	REPO_BASELINE_STATUSES,
	// Resume intent
	RESUME_INTENT_STATUSES,
	// Session kind
	SESSION_KINDS,
	// Session message direction
	SESSION_MESSAGE_DIRECTIONS,
	// Session operator
	SESSION_OPERATOR_STATUSES,
	// Session runtime
	SESSION_RUNTIME_STATUSES,
	// Wake event
	WAKE_EVENT_SOURCES,
	WAKE_EVENT_STATUSES,
	// Worker run
	WORKER_RUN_STATUSES,
	// Worker status
	WORKER_STATUSES,
	isActiveResumeIntentStatus,
	isNonTerminalSessionRuntimeStatus,
	isNonTerminalWorkerRunStatus,
	isTerminalSessionRuntimeStatus,
	isTerminalWakeEventStatus,
	isTerminalWorkerRunStatus,
	isValidActionInvocationTransition,
	isValidRepoBaselineTransition,
	isValidResumeIntentTransition,
	isValidSessionRuntimeTransition,
	isValidWakeEventTransition,
	isValidWorkerRunTransition,
	isValidWorkerTransition,
} from "./v1-entities";

// ============================================
// Worker Status Machine
// ============================================

describe("Worker status machine", () => {
	it("has exactly the canonical statuses", () => {
		expect(WORKER_STATUSES).toEqual(["active", "paused", "degraded", "failed"]);
	});

	it("allows active -> paused", () => {
		expect(isValidWorkerTransition("active", "paused")).toBe(true);
	});

	it("allows active -> degraded", () => {
		expect(isValidWorkerTransition("active", "degraded")).toBe(true);
	});

	it("allows active -> failed", () => {
		expect(isValidWorkerTransition("active", "failed")).toBe(true);
	});

	it("allows paused -> active", () => {
		expect(isValidWorkerTransition("paused", "active")).toBe(true);
	});

	it("allows failed -> active (explicit operator restart)", () => {
		expect(isValidWorkerTransition("failed", "active")).toBe(true);
	});

	it("rejects active -> active (no self-transition)", () => {
		expect(isValidWorkerTransition("active", "active")).toBe(false);
	});

	it("rejects paused -> degraded", () => {
		expect(isValidWorkerTransition("paused", "degraded")).toBe(false);
	});
});

// ============================================
// Wake Event Status Machine
// ============================================

describe("Wake event status machine", () => {
	it("has exactly the canonical statuses", () => {
		expect(WAKE_EVENT_STATUSES).toEqual([
			"queued",
			"claimed",
			"consumed",
			"coalesced",
			"cancelled",
			"failed",
		]);
	});

	it("has exactly the canonical sources", () => {
		expect(WAKE_EVENT_SOURCES).toEqual(["tick", "webhook", "manual", "manual_message"]);
	});

	it("allows queued -> claimed", () => {
		expect(isValidWakeEventTransition("queued", "claimed")).toBe(true);
	});

	it("allows queued -> coalesced", () => {
		expect(isValidWakeEventTransition("queued", "coalesced")).toBe(true);
	});

	it("allows claimed -> consumed", () => {
		expect(isValidWakeEventTransition("claimed", "consumed")).toBe(true);
	});

	it("rejects consumed -> anything (terminal)", () => {
		expect(isValidWakeEventTransition("consumed", "queued")).toBe(false);
		expect(isValidWakeEventTransition("consumed", "failed")).toBe(false);
	});

	it("identifies terminal statuses correctly", () => {
		expect(isTerminalWakeEventStatus("consumed")).toBe(true);
		expect(isTerminalWakeEventStatus("coalesced")).toBe(true);
		expect(isTerminalWakeEventStatus("cancelled")).toBe(true);
		expect(isTerminalWakeEventStatus("failed")).toBe(true);
		expect(isTerminalWakeEventStatus("queued")).toBe(false);
		expect(isTerminalWakeEventStatus("claimed")).toBe(false);
	});
});

// ============================================
// Worker Run Status Machine
// ============================================

describe("Worker run status machine", () => {
	it("has exactly the canonical statuses", () => {
		expect(WORKER_RUN_STATUSES).toEqual([
			"queued",
			"running",
			"completed",
			"failed",
			"cancelled",
			"health_degraded",
		]);
	});

	it("allows queued -> running", () => {
		expect(isValidWorkerRunTransition("queued", "running")).toBe(true);
	});

	it("allows running -> completed", () => {
		expect(isValidWorkerRunTransition("running", "completed")).toBe(true);
	});

	it("allows running -> health_degraded", () => {
		expect(isValidWorkerRunTransition("running", "health_degraded")).toBe(true);
	});

	it("allows health_degraded -> failed (explicit close)", () => {
		expect(isValidWorkerRunTransition("health_degraded", "failed")).toBe(true);
	});

	it("rejects completed -> running (terminal)", () => {
		expect(isValidWorkerRunTransition("completed", "running")).toBe(false);
	});

	it("identifies terminal statuses used in partial unique index", () => {
		expect(isTerminalWorkerRunStatus("completed")).toBe(true);
		expect(isTerminalWorkerRunStatus("failed")).toBe(true);
		expect(isTerminalWorkerRunStatus("cancelled")).toBe(true);
		expect(isTerminalWorkerRunStatus("health_degraded")).toBe(true);
		expect(isTerminalWorkerRunStatus("queued")).toBe(false);
		expect(isTerminalWorkerRunStatus("running")).toBe(false);
	});

	it("has explicit non-terminal statuses used by partial unique index", () => {
		expect(NON_TERMINAL_WORKER_RUN_STATUSES).toEqual(["queued", "running"]);
		expect(isNonTerminalWorkerRunStatus("queued")).toBe(true);
		expect(isNonTerminalWorkerRunStatus("running")).toBe(true);
		expect(isNonTerminalWorkerRunStatus("completed")).toBe(false);
	});
});

// ============================================
// Session Runtime Status Machine
// ============================================

describe("Session runtime status machine", () => {
	it("has exactly the canonical statuses", () => {
		expect(SESSION_RUNTIME_STATUSES).toEqual([
			"starting",
			"running",
			"paused",
			"completed",
			"failed",
			"cancelled",
		]);
	});

	it("allows starting -> running", () => {
		expect(isValidSessionRuntimeTransition("starting", "running")).toBe(true);
	});

	it("allows running -> paused", () => {
		expect(isValidSessionRuntimeTransition("running", "paused")).toBe(true);
	});

	it("allows paused -> running (resume)", () => {
		expect(isValidSessionRuntimeTransition("paused", "running")).toBe(true);
	});

	it("allows running -> completed", () => {
		expect(isValidSessionRuntimeTransition("running", "completed")).toBe(true);
	});

	it("rejects completed -> running (terminal)", () => {
		expect(isValidSessionRuntimeTransition("completed", "running")).toBe(false);
	});

	it("identifies terminal statuses", () => {
		expect(isTerminalSessionRuntimeStatus("completed")).toBe(true);
		expect(isTerminalSessionRuntimeStatus("failed")).toBe(true);
		expect(isTerminalSessionRuntimeStatus("cancelled")).toBe(true);
		expect(isTerminalSessionRuntimeStatus("starting")).toBe(false);
		expect(isTerminalSessionRuntimeStatus("running")).toBe(false);
		expect(isTerminalSessionRuntimeStatus("paused")).toBe(false);
	});

	it("has explicit non-terminal statuses used by setup-session partial unique index", () => {
		expect(NON_TERMINAL_SESSION_RUNTIME_STATUSES).toEqual(["starting", "running", "paused"]);
		expect(isNonTerminalSessionRuntimeStatus("starting")).toBe(true);
		expect(isNonTerminalSessionRuntimeStatus("running")).toBe(true);
		expect(isNonTerminalSessionRuntimeStatus("paused")).toBe(true);
		expect(isNonTerminalSessionRuntimeStatus("completed")).toBe(false);
	});
});

// ============================================
// Session Operator Status
// ============================================

describe("Session operator status", () => {
	it("has exactly the canonical statuses", () => {
		expect(SESSION_OPERATOR_STATUSES).toEqual([
			"active",
			"waiting_for_approval",
			"needs_input",
			"ready_for_review",
			"errored",
			"done",
		]);
	});
});

// ============================================
// Session Kind
// ============================================

describe("Session kinds", () => {
	it("has exactly manager | task | setup", () => {
		expect(SESSION_KINDS).toEqual(["manager", "task", "setup"]);
	});
});

// ============================================
// Session Message Direction
// ============================================

describe("Session message direction", () => {
	it("has the canonical direction set", () => {
		expect(SESSION_MESSAGE_DIRECTIONS).toEqual([
			"user_to_manager",
			"user_to_task",
			"manager_to_task",
			"task_to_manager",
		]);
	});

	it("includes user_to_task as required by spec", () => {
		expect(SESSION_MESSAGE_DIRECTIONS).toContain("user_to_task");
	});
});

// ============================================
// Repo Baseline Status Machine
// ============================================

describe("Repo baseline status machine", () => {
	it("has exactly the canonical statuses", () => {
		expect(REPO_BASELINE_STATUSES).toEqual(["validating", "ready", "stale", "failed"]);
	});

	it("allows validating -> ready", () => {
		expect(isValidRepoBaselineTransition("validating", "ready")).toBe(true);
	});

	it("allows ready -> stale", () => {
		expect(isValidRepoBaselineTransition("ready", "stale")).toBe(true);
	});

	it("allows stale -> validating", () => {
		expect(isValidRepoBaselineTransition("stale", "validating")).toBe(true);
	});

	it("allows failed -> validating", () => {
		expect(isValidRepoBaselineTransition("failed", "validating")).toBe(true);
	});

	it("rejects ready -> failed (no direct path)", () => {
		expect(isValidRepoBaselineTransition("ready", "failed")).toBe(false);
	});
});

// ============================================
// Action Invocation Status Machine
// ============================================

describe("Action invocation status machine", () => {
	it("allows pending -> approved -> executing -> completed", () => {
		expect(isValidActionInvocationTransition("pending", "approved")).toBe(true);
		expect(isValidActionInvocationTransition("approved", "executing")).toBe(true);
		expect(isValidActionInvocationTransition("executing", "completed")).toBe(true);
	});

	it("allows pending -> denied (terminal)", () => {
		expect(isValidActionInvocationTransition("pending", "denied")).toBe(true);
	});

	it("allows pending -> expired (terminal)", () => {
		expect(isValidActionInvocationTransition("pending", "expired")).toBe(true);
	});

	it("rejects completed -> anything (terminal)", () => {
		expect(isValidActionInvocationTransition("completed", "pending")).toBe(false);
	});
});

// ============================================
// Resume Intent Status Machine
// ============================================

describe("Resume intent status machine", () => {
	it("allows queued -> claimed -> resuming -> satisfied", () => {
		expect(isValidResumeIntentTransition("queued", "claimed")).toBe(true);
		expect(isValidResumeIntentTransition("claimed", "resuming")).toBe(true);
		expect(isValidResumeIntentTransition("resuming", "satisfied")).toBe(true);
	});

	it("allows claimed -> continued", () => {
		expect(isValidResumeIntentTransition("claimed", "continued")).toBe(true);
	});

	it("rejects satisfied -> anything (terminal)", () => {
		expect(isValidResumeIntentTransition("satisfied", "queued")).toBe(false);
	});

	it("has explicit active statuses used by partial unique index", () => {
		expect(ACTIVE_RESUME_INTENT_STATUSES).toEqual(["queued", "claimed", "resuming"]);
		expect(isActiveResumeIntentStatus("queued")).toBe(true);
		expect(isActiveResumeIntentStatus("claimed")).toBe(true);
		expect(isActiveResumeIntentStatus("resuming")).toBe(true);
		expect(isActiveResumeIntentStatus("satisfied")).toBe(false);
	});
});
