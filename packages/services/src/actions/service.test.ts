import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

const {
	mockCreateInvocation,
	mockGetInvocation,
	mockUpdateInvocationStatus,
	mockListPendingBySession,
} = vi.hoisted(() => ({
	mockCreateInvocation: vi.fn(),
	mockGetInvocation: vi.fn(),
	mockUpdateInvocationStatus: vi.fn(),
	mockListPendingBySession: vi.fn(),
}));

vi.mock("./db", () => ({
	createInvocation: mockCreateInvocation,
	getInvocation: mockGetInvocation,
	updateInvocationStatus: mockUpdateInvocationStatus,
	listBySession: vi.fn().mockResolvedValue([]),
	listPendingBySession: mockListPendingBySession,
	expirePendingInvocations: vi.fn().mockResolvedValue(0),
	listByOrg: vi.fn().mockResolvedValue([]),
	countByOrg: vi.fn().mockResolvedValue(0),
}));

vi.mock("../logger", () => ({
	getServicesLogger: () => ({
		child: () => ({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}),
	}),
}));

const { invokeAction, PendingLimitError } = await import("./service");

// ============================================
// Helpers
// ============================================

function makeInvocationRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "inv-1",
		sessionId: "session-1",
		organizationId: "org-1",
		integrationId: "int-1",
		integration: "linear",
		action: "create_issue",
		riskLevel: "write",
		params: { title: "Bug" },
		status: "pending",
		result: null,
		error: null,
		durationMs: null,
		approvedBy: null,
		approvedAt: null,
		completedAt: null,
		expiresAt: null,
		createdAt: new Date(),
		...overrides,
	};
}

const baseInput = {
	sessionId: "session-1",
	organizationId: "org-1",
	integrationId: "int-1",
	integration: "linear",
	action: "create_issue",
	riskLevel: "write" as const,
	params: { title: "Bug" },
};

// ============================================
// Tests: Three-Mode Permissioning Cascade
// ============================================

describe("invokeAction with modes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListPendingBySession.mockResolvedValue([]);
	});

	it("auto-approves read actions in auto mode", async () => {
		const row = makeInvocationRow({ status: "approved", riskLevel: "read" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({ ...baseInput, riskLevel: "read" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("approved");
	});

	it("denies danger actions in auto mode", async () => {
		const row = makeInvocationRow({ status: "denied", riskLevel: "danger" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({ ...baseInput, riskLevel: "danger" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("denied");
	});

	it("auto-approves write actions in auto mode (no drift)", async () => {
		const row = makeInvocationRow({ status: "approved" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("approved");
	});

	it("requires approval when drift is detected on auto mode", async () => {
		const row = makeInvocationRow({ status: "pending", expiresAt: new Date() });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({
			...baseInput,
			riskLevel: "read",
			driftDetected: true,
		});

		expect(result.needsApproval).toBe(true);
		expect(result.invocation.status).toBe("pending");
	});

	it("always requires approval in approve mode", async () => {
		const row = makeInvocationRow({ status: "pending", expiresAt: new Date() });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({
			...baseInput,
			riskLevel: "read",
			modes: { defaultMode: "approve" },
		});

		expect(result.needsApproval).toBe(true);
	});

	it("always denies in deny mode", async () => {
		const row = makeInvocationRow({ status: "denied" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({
			...baseInput,
			riskLevel: "read",
			modes: { defaultMode: "deny" },
		});

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("denied");
	});

	it("per-action override takes precedence over default", async () => {
		const row = makeInvocationRow({ status: "denied" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({
			...baseInput,
			modes: {
				defaultMode: "auto",
				actions: { "linear:create_issue": "deny" },
			},
		});

		expect(result.invocation.status).toBe("denied");
	});

	it("per-integration override takes precedence over default", async () => {
		const row = makeInvocationRow({ status: "pending", expiresAt: new Date() });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({
			...baseInput,
			modes: {
				defaultMode: "auto",
				integrations: { linear: "approve" },
			},
		});

		expect(result.needsApproval).toBe(true);
	});

	it("throws PendingLimitError when pending cap exceeded", async () => {
		mockListPendingBySession.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` })),
		);
		const row = makeInvocationRow({ status: "pending" });
		mockCreateInvocation.mockResolvedValue(row);

		await expect(
			invokeAction({
				...baseInput,
				modes: { defaultMode: "approve" },
			}),
		).rejects.toThrow(PendingLimitError);
	});

	it("deny mode is never overridden by drift", async () => {
		const row = makeInvocationRow({ status: "denied" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({
			...baseInput,
			modes: { defaultMode: "deny" },
			driftDetected: true,
		});

		expect(result.invocation.status).toBe("denied");
	});
});
