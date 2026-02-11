import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

const {
	mockCreateInvocation,
	mockGetInvocation,
	mockUpdateInvocationStatus,
	mockListPendingBySession,
	mockEvaluateGrant,
} = vi.hoisted(() => ({
	mockCreateInvocation: vi.fn(),
	mockGetInvocation: vi.fn(),
	mockUpdateInvocationStatus: vi.fn(),
	mockListPendingBySession: vi.fn(),
	mockEvaluateGrant: vi.fn(),
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

vi.mock("./grants", () => ({
	evaluateGrant: mockEvaluateGrant,
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
// Tests
// ============================================

describe("invokeAction with grants", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGrant.mockResolvedValue({ granted: false });
		mockListPendingBySession.mockResolvedValue([]);
	});

	it("auto-approves read actions without checking grants", async () => {
		const row = makeInvocationRow({ status: "approved", riskLevel: "read" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({ ...baseInput, riskLevel: "read" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("approved");
		expect(mockEvaluateGrant).not.toHaveBeenCalled();
	});

	it("denies danger actions without checking grants", async () => {
		const row = makeInvocationRow({ status: "denied", riskLevel: "danger" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({ ...baseInput, riskLevel: "danger" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("denied");
		expect(mockEvaluateGrant).not.toHaveBeenCalled();
	});

	it("auto-approves write action when a matching grant exists", async () => {
		mockEvaluateGrant.mockResolvedValue({ granted: true, grantId: "grant-1" });
		const row = makeInvocationRow({ status: "approved" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("approved");
		expect(mockEvaluateGrant).toHaveBeenCalledWith("org-1", "linear", "create_issue", "session-1");
		expect(mockCreateInvocation).toHaveBeenCalledWith(
			expect.objectContaining({ status: "approved" }),
		);
	});

	it("requires approval for write action when no grant matches", async () => {
		mockEvaluateGrant.mockResolvedValue({ granted: false });
		const row = makeInvocationRow({ status: "pending", expiresAt: new Date() });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		expect(result.needsApproval).toBe(true);
		expect(result.invocation.status).toBe("pending");
		expect(mockCreateInvocation).toHaveBeenCalledWith(
			expect.objectContaining({ status: "pending" }),
		);
	});

	it("preserves backward compatibility: write without grants sets expiry", async () => {
		mockEvaluateGrant.mockResolvedValue({ granted: false });
		const row = makeInvocationRow({ status: "pending", expiresAt: expect.any(Date) });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		expect(result.needsApproval).toBe(true);
		expect(mockCreateInvocation).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "pending",
				expiresAt: expect.any(Date),
			}),
		);
	});

	it("grant-approved write bypasses pending cap", async () => {
		// 10 pending actions already — at the limit
		mockListPendingBySession.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` })),
		);
		mockEvaluateGrant.mockResolvedValue({ granted: true, grantId: "grant-1" });
		const row = makeInvocationRow({ status: "approved" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		// Should succeed because grant-approved writes never check pending cap
		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("approved");
		expect(mockListPendingBySession).not.toHaveBeenCalled();
	});

	it("throws PendingLimitError when no grant and pending cap exceeded", async () => {
		mockListPendingBySession.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` })),
		);
		mockEvaluateGrant.mockResolvedValue({ granted: false });

		await expect(invokeAction(baseInput)).rejects.toThrow(PendingLimitError);
		expect(mockCreateInvocation).not.toHaveBeenCalled();
	});
});
