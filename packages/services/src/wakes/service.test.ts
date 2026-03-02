import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWakeEvent, mockTransitionWakeEventStatus, mockFindWakeEventById } = vi.hoisted(
	() => ({
		mockCreateWakeEvent: vi.fn(),
		mockTransitionWakeEventStatus: vi.fn(),
		mockFindWakeEventById: vi.fn(),
	}),
);

vi.mock("./db", () => ({
	createWakeEvent: mockCreateWakeEvent,
	transitionWakeEventStatus: mockTransitionWakeEventStatus,
	findWakeEventById: mockFindWakeEventById,
}));

const { WakeTransitionError, cancelQueuedWake, enqueueWake, isTerminalWake, transitionWakeStatus } =
	await import("./service");

function makeWake(overrides: Record<string, unknown> = {}) {
	return {
		id: "wake-1",
		workerId: "worker-1",
		organizationId: "org-1",
		source: "manual",
		status: "queued",
		payloadJson: null,
		coalescedIntoWakeEventId: null,
		createdAt: new Date(),
		claimedAt: null,
		consumedAt: null,
		failedAt: null,
		...overrides,
	};
}

describe("wakes service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("enqueues wake rows", async () => {
		const row = makeWake();
		mockCreateWakeEvent.mockResolvedValue(row);

		const result = await enqueueWake({
			workerId: "worker-1",
			organizationId: "org-1",
			source: "manual",
			payloadJson: { reason: "run_now" },
		});

		expect(result.id).toBe("wake-1");
		expect(mockCreateWakeEvent).toHaveBeenCalled();
	});

	it("transitions queued -> cancelled", async () => {
		mockFindWakeEventById.mockResolvedValue(makeWake({ status: "queued" }));
		mockTransitionWakeEventStatus.mockResolvedValue(makeWake({ status: "cancelled" }));

		const row = await cancelQueuedWake("wake-1", "org-1");

		expect(row.status).toBe("cancelled");
		expect(mockTransitionWakeEventStatus).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "wake-1",
				organizationId: "org-1",
				fromStatuses: ["queued"],
				toStatus: "cancelled",
			}),
		);
	});

	it("rejects invalid transitions", async () => {
		mockFindWakeEventById.mockResolvedValue(makeWake({ status: "consumed" }));

		await expect(
			transitionWakeStatus({
				wakeEventId: "wake-1",
				organizationId: "org-1",
				toStatus: "claimed",
			}),
		).rejects.toBeInstanceOf(WakeTransitionError);

		expect(mockTransitionWakeEventStatus).not.toHaveBeenCalled();
	});

	it("reports terminal wake status", async () => {
		mockFindWakeEventById.mockResolvedValue(makeWake({ status: "failed" }));

		const terminal = await isTerminalWake("wake-1", "org-1");

		expect(terminal).toBe(true);
	});
});
