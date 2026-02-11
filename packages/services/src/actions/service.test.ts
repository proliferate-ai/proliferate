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
	mockCreateGrant,
	mockRevokeGrant,
} = vi.hoisted(() => ({
	mockCreateInvocation: vi.fn(),
	mockGetInvocation: vi.fn(),
	mockUpdateInvocationStatus: vi.fn(),
	mockListPendingBySession: vi.fn(),
	mockEvaluateGrant: vi.fn(),
	mockCreateGrant: vi.fn(),
	mockRevokeGrant: vi.fn(),
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
	createGrant: mockCreateGrant,
	revokeGrant: mockRevokeGrant,
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

const {
	invokeAction,
	approveActionWithGrant,
	PendingLimitError,
	ActionNotFoundError,
	ActionExpiredError,
	ActionConflictError,
} = await import("./service");

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

// ============================================
// approveActionWithGrant
// ============================================

describe("approveActionWithGrant", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const pendingInvocation = makeInvocationRow({
		status: "pending",
		expiresAt: new Date(Date.now() + 300_000),
	});

	const grantRow = {
		id: "grant-1",
		organizationId: "org-1",
		createdBy: "user-1",
		sessionId: "session-1",
		integration: "linear",
		action: "create_issue",
		maxCalls: 10,
		usedCalls: 0,
		expiresAt: null,
		revokedAt: null,
		createdAt: new Date(),
	};

	it("creates a session-scoped grant and approves invocation", async () => {
		mockGetInvocation.mockResolvedValue(pendingInvocation);
		mockCreateGrant.mockResolvedValue(grantRow);
		const approved = makeInvocationRow({ status: "approved", approvedBy: "user-1" });
		mockUpdateInvocationStatus.mockResolvedValue(approved);

		const result = await approveActionWithGrant("inv-1", "org-1", "user-1", {
			scope: "session",
			maxCalls: 10,
		});

		expect(result.invocation.status).toBe("approved");
		expect(result.grant.id).toBe("grant-1");
		expect(mockCreateGrant).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				integration: "linear",
				action: "create_issue",
				maxCalls: 10,
			}),
		);
	});

	it("creates an org-wide grant when scope='org'", async () => {
		mockGetInvocation.mockResolvedValue(pendingInvocation);
		mockCreateGrant.mockResolvedValue({ ...grantRow, sessionId: null });
		const approved = makeInvocationRow({ status: "approved" });
		mockUpdateInvocationStatus.mockResolvedValue(approved);

		await approveActionWithGrant("inv-1", "org-1", "user-1", {
			scope: "org",
			maxCalls: null,
		});

		expect(mockCreateGrant).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: undefined,
				maxCalls: null,
			}),
		);
	});

	it("rolls back grant if invocation update fails", async () => {
		mockGetInvocation.mockResolvedValue(pendingInvocation);
		mockCreateGrant.mockResolvedValue(grantRow);
		mockRevokeGrant.mockResolvedValue(undefined);
		mockUpdateInvocationStatus.mockResolvedValue(undefined); // update returns nothing

		await expect(
			approveActionWithGrant("inv-1", "org-1", "user-1", { scope: "session" }),
		).rejects.toThrow(ActionConflictError);

		expect(mockRevokeGrant).toHaveBeenCalledWith("grant-1", "org-1");
	});

	it("throws ActionNotFoundError for missing invocation", async () => {
		mockGetInvocation.mockResolvedValue(undefined);

		await expect(
			approveActionWithGrant("inv-1", "org-1", "user-1", { scope: "session" }),
		).rejects.toThrow(ActionNotFoundError);

		expect(mockCreateGrant).not.toHaveBeenCalled();
	});

	it("throws ActionExpiredError for expired invocation", async () => {
		const expired = makeInvocationRow({
			status: "pending",
			expiresAt: new Date(Date.now() - 1000),
		});
		mockGetInvocation.mockResolvedValue(expired);
		mockUpdateInvocationStatus.mockResolvedValue(expired);

		await expect(
			approveActionWithGrant("inv-1", "org-1", "user-1", { scope: "session" }),
		).rejects.toThrow(ActionExpiredError);

		expect(mockCreateGrant).not.toHaveBeenCalled();
	});

	it("throws ActionConflictError for non-pending invocation", async () => {
		const approved = makeInvocationRow({ status: "approved" });
		mockGetInvocation.mockResolvedValue(approved);

		await expect(
			approveActionWithGrant("inv-1", "org-1", "user-1", { scope: "session" }),
		).rejects.toThrow(ActionConflictError);

		expect(mockCreateGrant).not.toHaveBeenCalled();
	});

	it("defaults maxCalls to null when not provided", async () => {
		mockGetInvocation.mockResolvedValue(pendingInvocation);
		mockCreateGrant.mockResolvedValue({ ...grantRow, maxCalls: null });
		const approved = makeInvocationRow({ status: "approved" });
		mockUpdateInvocationStatus.mockResolvedValue(approved);

		await approveActionWithGrant("inv-1", "org-1", "user-1", { scope: "session" });

		expect(mockCreateGrant).toHaveBeenCalledWith(expect.objectContaining({ maxCalls: null }));
	});
});
