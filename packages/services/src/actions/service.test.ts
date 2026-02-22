import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

const { mockCreateInvocation, mockListPendingBySession, mockResolveMode } = vi.hoisted(() => ({
	mockCreateInvocation: vi.fn(),
	mockListPendingBySession: vi.fn(),
	mockResolveMode: vi.fn(),
}));

vi.mock("./db", () => ({
	createInvocation: mockCreateInvocation,
	getInvocation: vi.fn(),
	updateInvocationStatus: vi.fn(),
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

vi.mock("./modes", () => ({
	resolveMode: mockResolveMode,
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

describe("invokeAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListPendingBySession.mockResolvedValue([]);
		mockResolveMode.mockImplementation(
			async (input: { riskLevel: "read" | "write" | "danger" }) => {
				if (input.riskLevel === "read") {
					return { mode: "allow", source: "inferred_default" };
				}
				if (input.riskLevel === "danger") {
					return { mode: "deny", source: "inferred_default" };
				}
				return { mode: "require_approval", source: "inferred_default" };
			},
		);
	});

	it("auto-approves read actions", async () => {
		const row = makeInvocationRow({ status: "approved", riskLevel: "read" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({ ...baseInput, riskLevel: "read" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("approved");
	});

	it("denies danger actions", async () => {
		const row = makeInvocationRow({ status: "denied", riskLevel: "danger" });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction({ ...baseInput, riskLevel: "danger" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("denied");
	});

	it("requires approval for write actions", async () => {
		const row = makeInvocationRow({ status: "pending", expiresAt: new Date() });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		expect(result.needsApproval).toBe(true);
		expect(result.invocation.status).toBe("pending");
		expect(mockCreateInvocation).toHaveBeenCalledWith(
			expect.objectContaining({ status: "pending" }),
		);
	});

	it("throws PendingLimitError when pending cap exceeded", async () => {
		mockListPendingBySession.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` })),
		);

		await expect(invokeAction(baseInput)).rejects.toThrow(PendingLimitError);
		expect(mockCreateInvocation).not.toHaveBeenCalled();
	});
});
