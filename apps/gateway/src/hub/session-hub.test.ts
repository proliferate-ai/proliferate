import { sessions } from "@proliferate/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as leases from "../lib/session-leases";
import { SessionHub } from "./session-hub";

type HubStub = {
	sessionId: string;
	lifecycleStartTime: number;
	lastKnownAgentIdleAt: number | null;
	runtime: { ensureRuntimeReady: ReturnType<typeof vi.fn> };
	telemetry: { startRunning: ReturnType<typeof vi.fn> };
	startLeaseRenewal: ReturnType<typeof vi.fn>;
	stopLeaseRenewal: ReturnType<typeof vi.fn>;
	startMigrationMonitor: ReturnType<typeof vi.fn>;
};

type EnsureRuntimeReadyMethod = (
	this: HubStub,
	options?: { reason?: "auto_reconnect" },
) => Promise<void>;
type StopLeaseRenewalMethod = (this: {
	leaseRenewTimer: ReturnType<typeof setInterval> | null;
	ownsOwnerLease: boolean;
	sessionId: string;
	instanceId: string;
	logger: { error: ReturnType<typeof vi.fn> };
}) => void;

type MaybeSendInitialPromptMethod = (this: {
	initialPromptSending: boolean;
	sessionId: string;
	runtime: {
		getContext: () => {
			initialPrompt?: string | null;
			session: {
				created_by?: string | null;
				initial_prompt_sent_at?: string | null;
			};
		};
	};
	log: ReturnType<typeof vi.fn>;
	logError: ReturnType<typeof vi.fn>;
	handlePrompt: ReturnType<typeof vi.fn>;
}) => Promise<void>;

type HandleSseDisconnectMethod = (
	this: {
		runtime: {
			getContext: () => {
				session: {
					client_type?: string | null;
					status?: string | null;
					sandbox_id?: string | null;
					sandbox_expires_at?: string | null;
				};
			};
		};
		clients: Map<unknown, unknown>;
		log: ReturnType<typeof vi.fn>;
		broadcastStatus: ReturnType<typeof vi.fn>;
		scheduleReconnect: ReturnType<typeof vi.fn>;
	},
	reason: string,
) => void;

function createHubStub(): HubStub {
	return {
		sessionId: "session-1",
		lifecycleStartTime: 0,
		lastKnownAgentIdleAt: Date.now(),
		runtime: {
			ensureRuntimeReady: vi.fn(async () => undefined),
		},
		telemetry: {
			startRunning: vi.fn(() => undefined),
		},
		startLeaseRenewal: vi.fn(async () => undefined),
		stopLeaseRenewal: vi.fn(() => undefined),
		startMigrationMonitor: vi.fn(() => undefined),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SessionHub lease ordering", () => {
	it("acquires owner lease before runtime lifecycle work", async () => {
		const calls: string[] = [];
		const hub = createHubStub();
		hub.startLeaseRenewal.mockImplementation(async () => {
			calls.push("lease");
		});
		hub.runtime.ensureRuntimeReady.mockImplementation(async () => {
			calls.push("runtime");
		});
		hub.startMigrationMonitor.mockImplementation(() => {
			calls.push("monitor");
		});
		const runtimeLeaseSpy = vi.spyOn(leases, "setRuntimeLease").mockImplementation(async () => {
			calls.push("runtime_lease");
		});
		const ensureRuntimeReady = (
			SessionHub.prototype as unknown as { ensureRuntimeReady: EnsureRuntimeReadyMethod }
		).ensureRuntimeReady;

		await ensureRuntimeReady.call(hub);

		expect(calls).toEqual(["lease", "runtime", "monitor", "runtime_lease"]);
		expect(runtimeLeaseSpy).toHaveBeenCalledWith("session-1");
	});

	it("releases lease ownership if runtime initialization fails", async () => {
		const calls: string[] = [];
		const hub = createHubStub();
		hub.startLeaseRenewal.mockImplementation(async () => {
			calls.push("lease");
		});
		hub.runtime.ensureRuntimeReady.mockImplementation(async () => {
			calls.push("runtime");
			throw new Error("runtime failed");
		});
		hub.stopLeaseRenewal.mockImplementation(() => {
			calls.push("stop_lease");
		});
		const runtimeLeaseSpy = vi.spyOn(leases, "setRuntimeLease");
		const ensureRuntimeReady = (
			SessionHub.prototype as unknown as { ensureRuntimeReady: EnsureRuntimeReadyMethod }
		).ensureRuntimeReady;

		await expect(ensureRuntimeReady.call(hub)).rejects.toThrow("runtime failed");

		expect(calls).toEqual(["lease", "runtime", "stop_lease"]);
		expect(hub.startMigrationMonitor).not.toHaveBeenCalled();
		expect(runtimeLeaseSpy).not.toHaveBeenCalled();
	});
});

describe("SessionHub lease cleanup", () => {
	it("does not clear shared runtime lease if this hub never owned owner lease", () => {
		const releaseSpy = vi.spyOn(leases, "releaseOwnerLease").mockResolvedValue();
		const clearSpy = vi.spyOn(leases, "clearRuntimeLease").mockResolvedValue();
		const hub = {
			leaseRenewTimer: null,
			ownsOwnerLease: false,
			sessionId: "session-1",
			instanceId: "instance-1",
			logger: { error: vi.fn() },
		};
		const stopLeaseRenewal = (
			SessionHub.prototype as unknown as { stopLeaseRenewal: StopLeaseRenewalMethod }
		).stopLeaseRenewal;

		stopLeaseRenewal.call(hub);

		expect(releaseSpy).not.toHaveBeenCalled();
		expect(clearSpy).not.toHaveBeenCalled();
	});

	it("releases owner + runtime leases when this hub owns the session", () => {
		const releaseSpy = vi.spyOn(leases, "releaseOwnerLease").mockResolvedValue();
		const clearSpy = vi.spyOn(leases, "clearRuntimeLease").mockResolvedValue();
		const hub = {
			leaseRenewTimer: null,
			ownsOwnerLease: true,
			sessionId: "session-1",
			instanceId: "instance-1",
			logger: { error: vi.fn() },
		};
		const stopLeaseRenewal = (
			SessionHub.prototype as unknown as { stopLeaseRenewal: StopLeaseRenewalMethod }
		).stopLeaseRenewal;

		stopLeaseRenewal.call(hub);

		expect(releaseSpy).toHaveBeenCalledWith("session-1", "instance-1");
		expect(clearSpy).toHaveBeenCalledWith("session-1");
		expect((hub as { ownsOwnerLease: boolean }).ownsOwnerLease).toBe(false);
	});
});

describe("SessionHub initial prompt auto-send", () => {
	it("marks initial prompt as sent and dispatches once", async () => {
		const updateSpy = vi.spyOn(sessions, "update").mockResolvedValue(undefined);
		const hub = {
			initialPromptSending: false,
			sessionId: "session-1",
			runtime: {
				getContext: () => ({
					initialPrompt: "Set up this repo",
					session: {
						created_by: "user-1",
						initial_prompt_sent_at: null,
					},
				}),
			},
			log: vi.fn(),
			logError: vi.fn(),
			handlePrompt: vi.fn(async () => undefined),
		};
		const maybeSendInitialPrompt = (
			SessionHub.prototype as unknown as { maybeSendInitialPrompt: MaybeSendInitialPromptMethod }
		).maybeSendInitialPrompt;

		await maybeSendInitialPrompt.call(hub);

		expect(updateSpy).toHaveBeenCalledTimes(1);
		expect(updateSpy).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({
				initialPromptSentAt: expect.any(String),
			}),
		);
		expect(hub.handlePrompt).toHaveBeenCalledWith("Set up this repo", "user-1", { source: "web" });
		expect(hub.initialPromptSending).toBe(false);
	});

	it("clears sent marker when auto-send fails so next init can retry", async () => {
		const updateSpy = vi.spyOn(sessions, "update").mockResolvedValue(undefined);
		const context = {
			initialPrompt: "Set up this repo",
			session: {
				created_by: "user-1",
				initial_prompt_sent_at: null as string | null,
			},
		};
		const hub = {
			initialPromptSending: false,
			sessionId: "session-1",
			runtime: {
				getContext: () => context,
			},
			log: vi.fn(),
			logError: vi.fn(),
			handlePrompt: vi
				.fn()
				.mockRejectedValueOnce(new Error("send failed"))
				.mockResolvedValueOnce(undefined),
		};
		const maybeSendInitialPrompt = (
			SessionHub.prototype as unknown as { maybeSendInitialPrompt: MaybeSendInitialPromptMethod }
		).maybeSendInitialPrompt;

		await expect(maybeSendInitialPrompt.call(hub)).rejects.toThrow("send failed");

		expect(updateSpy).toHaveBeenCalledTimes(2);
		expect(updateSpy).toHaveBeenNthCalledWith(
			1,
			"session-1",
			expect.objectContaining({
				initialPromptSentAt: expect.any(String),
			}),
		);
		expect(updateSpy).toHaveBeenNthCalledWith(2, "session-1", { initialPromptSentAt: null });
		expect(context.session.initial_prompt_sent_at).toBeNull();
		expect(hub.initialPromptSending).toBe(false);

		await maybeSendInitialPrompt.call(hub);

		expect(updateSpy).toHaveBeenCalledTimes(3);
		expect(hub.handlePrompt).toHaveBeenCalledTimes(2);
	});
});

describe("SessionHub SSE reconnect policy", () => {
	it("skips auto-reconnect for headless running automation sessions", () => {
		const hub = {
			runtime: {
				getContext: () => ({
					session: {
						client_type: "automation",
						status: "running",
						sandbox_id: "sb-1",
						sandbox_expires_at: null,
					},
				}),
			},
			clients: new Map(),
			log: vi.fn(),
			broadcastStatus: vi.fn(),
			scheduleReconnect: vi.fn(),
		};
		const handleSseDisconnect = (
			SessionHub.prototype as unknown as { handleSseDisconnect: HandleSseDisconnectMethod }
		).handleSseDisconnect;

		handleSseDisconnect.call(hub, "stream_closed");

		expect(hub.scheduleReconnect).not.toHaveBeenCalled();
		expect(hub.broadcastStatus).not.toHaveBeenCalled();
		expect(hub.log).toHaveBeenCalledWith("Skipping auto-reconnect for headless automation session");
	});
});

describe("SessionHub completed automation detection", () => {
	it("treats paused automation_completed sessions as completed", () => {
		const hub = {
			runtime: {
				getContext: () => ({
					session: {
						client_type: "automation",
						status: "paused",
						pause_reason: "automation_completed",
					},
				}),
			},
		};
		const isCompletedAutomationSession = (
			SessionHub.prototype as unknown as {
				isCompletedAutomationSession: (this: typeof hub) => boolean;
			}
		).isCompletedAutomationSession;

		expect(isCompletedAutomationSession.call(hub)).toBe(true);
	});

	it("treats stopped automation_completed sessions as completed", () => {
		const hub = {
			runtime: {
				getContext: () => ({
					session: {
						client_type: "automation",
						status: "stopped",
						pause_reason: "automation_completed",
					},
				}),
			},
		};
		const isCompletedAutomationSession = (
			SessionHub.prototype as unknown as {
				isCompletedAutomationSession: (this: typeof hub) => boolean;
			}
		).isCompletedAutomationSession;

		expect(isCompletedAutomationSession.call(hub)).toBe(true);
	});
});
