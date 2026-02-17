import { afterEach, describe, expect, it, vi } from "vitest";
import * as leases from "../lib/session-leases";
import { SessionHub } from "./session-hub";

type HubStub = {
	sessionId: string;
	lifecycleStartTime: number;
	lastKnownAgentIdleAt: number | null;
	runtime: { ensureRuntimeReady: ReturnType<typeof vi.fn> };
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

function createHubStub(): HubStub {
	return {
		sessionId: "session-1",
		lifecycleStartTime: 0,
		lastKnownAgentIdleAt: Date.now(),
		runtime: {
			ensureRuntimeReady: vi.fn(async () => undefined),
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
