import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateInvocation,
	mockListPendingBySession,
	mockResolveMode,
	mockGetSessionCapabilityMode,
	mockSetSessionOperatorStatus,
	mockCreateActionInvocationEvent,
	mockGetInvocation,
	mockTransitionInvocationStatus,
	mockGetSessionApprovalContext,
	mockCreateOrGetActiveResumeIntent,
	mockListExpirablePendingInvocations,
	mockGetSessionAclRole,
} = vi.hoisted(() => ({
	mockCreateInvocation: vi.fn(),
	mockListPendingBySession: vi.fn(),
	mockResolveMode: vi.fn(),
	mockGetSessionCapabilityMode: vi.fn(),
	mockSetSessionOperatorStatus: vi.fn(),
	mockCreateActionInvocationEvent: vi.fn(),
	mockGetInvocation: vi.fn(),
	mockTransitionInvocationStatus: vi.fn(),
	mockGetSessionApprovalContext: vi.fn(),
	mockCreateOrGetActiveResumeIntent: vi.fn(),
	mockListExpirablePendingInvocations: vi.fn(),
	mockGetSessionAclRole: vi.fn(),
}));

vi.mock("./db", () => ({
	createInvocation: mockCreateInvocation,
	getInvocation: mockGetInvocation,
	getInvocationById: vi.fn(),
	updateInvocationStatus: vi.fn(),
	transitionInvocationStatus: mockTransitionInvocationStatus,
	listBySession: vi.fn().mockResolvedValue([]),
	listPendingBySession: mockListPendingBySession,
	listExpirablePendingInvocations: mockListExpirablePendingInvocations,
	expirePendingInvocations: vi.fn().mockResolvedValue(0),
	listByOrg: vi.fn().mockResolvedValue([]),
	countByOrg: vi.fn().mockResolvedValue(0),
	getSessionCapabilityMode: mockGetSessionCapabilityMode,
	setSessionOperatorStatus: mockSetSessionOperatorStatus,
	createActionInvocationEvent: mockCreateActionInvocationEvent,
	getSessionApprovalContext: mockGetSessionApprovalContext,
	createOrGetActiveResumeIntent: mockCreateOrGetActiveResumeIntent,
	getSessionAclRole: mockGetSessionAclRole,
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

const {
	invokeAction,
	PendingLimitError,
	denyAction,
	markCompleted,
	approveAction,
	ActionConflictError,
	assertApprovalAuthority,
	ApprovalAuthorityError,
} = await import("./service");

function makeInvocationRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "inv-1",
		sessionId: "session-1",
		organizationId: "org-1",
		integrationId: "int-1",
		integration: "linear",
		action: "create_issue",
		riskLevel: "write",
		mode: "require_approval",
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

describe("actions v1 service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListPendingBySession.mockResolvedValue([]);
		mockGetSessionCapabilityMode.mockResolvedValue(undefined);
		mockSetSessionOperatorStatus.mockResolvedValue(true);
		mockCreateActionInvocationEvent.mockResolvedValue({ id: "evt-1" });
		mockCreateOrGetActiveResumeIntent.mockResolvedValue({ id: "resume-1" });
		mockListExpirablePendingInvocations.mockResolvedValue([]);
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

	it("requires approval for write actions, sets waiting status, and does not queue resume intent", async () => {
		const row = makeInvocationRow({ status: "pending", expiresAt: new Date() });
		mockCreateInvocation.mockResolvedValue(row);

		const result = await invokeAction(baseInput);

		expect(result.needsApproval).toBe(true);
		expect(result.invocation.status).toBe("pending");
		expect(mockSetSessionOperatorStatus).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				toStatus: "waiting_for_approval",
			}),
		);
		expect(mockCreateOrGetActiveResumeIntent).not.toHaveBeenCalled();
	});

	it("applies live session capability authority with strictest precedence", async () => {
		mockResolveMode.mockResolvedValue({ mode: "allow", source: "inferred_default" });
		mockGetSessionCapabilityMode.mockResolvedValue("deny");
		mockCreateInvocation.mockResolvedValue(makeInvocationRow({ status: "denied", mode: "deny" }));

		const result = await invokeAction({ ...baseInput, riskLevel: "read" });

		expect(result.needsApproval).toBe(false);
		expect(result.invocation.status).toBe("denied");
		expect(mockCreateInvocation).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "denied",
				mode: "deny",
			}),
		);
	});

	it("throws PendingLimitError when pending cap exceeded", async () => {
		mockListPendingBySession.mockResolvedValue(
			Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` })),
		);

		await expect(invokeAction(baseInput)).rejects.toThrow(PendingLimitError);
		expect(mockCreateInvocation).not.toHaveBeenCalled();
	});

	it("queues resume intent only after terminal denied outcome on blocked path", async () => {
		mockGetInvocation.mockResolvedValue(
			makeInvocationRow({ status: "pending", mode: "require_approval" }),
		);
		mockTransitionInvocationStatus.mockResolvedValue(
			makeInvocationRow({ status: "denied", mode: "require_approval" }),
		);
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "waiting_for_approval",
			visibility: "private",
			createdBy: "user-1",
			repoId: "repo-1",
		});

		await denyAction("inv-1", "org-1", "user-1");

		expect(mockCreateOrGetActiveResumeIntent).toHaveBeenCalledWith(
			expect.objectContaining({
				originSessionId: "session-1",
				invocationId: "inv-1",
			}),
		);
	});

	it("queues resume intent after completed terminal outcome for approval-gated invocation", async () => {
		mockTransitionInvocationStatus.mockResolvedValue(
			makeInvocationRow({ status: "completed", mode: "require_approval" }),
		);
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "waiting_for_approval",
			visibility: "private",
			createdBy: "user-1",
			repoId: "repo-1",
		});

		await markCompleted("inv-1", { ok: true }, 12);

		expect(mockCreateOrGetActiveResumeIntent).toHaveBeenCalled();
	});

	it("revalidates policy at approval time and rejects when now denied", async () => {
		mockGetInvocation.mockResolvedValue(
			makeInvocationRow({ status: "pending", mode: "require_approval" }),
		);
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "waiting_for_approval",
			visibility: "private",
			createdBy: "user-1",
			repoId: "repo-1",
		});
		mockResolveMode.mockResolvedValue({ mode: "deny", source: "org_default" });
		mockTransitionInvocationStatus.mockResolvedValue(
			makeInvocationRow({ status: "denied", mode: "require_approval" }),
		);

		await expect(approveAction("inv-1", "org-1", "approver-1")).rejects.toBeInstanceOf(
			ActionConflictError,
		);
		expect(mockTransitionInvocationStatus).toHaveBeenCalledWith(
			expect.objectContaining({ toStatus: "denied" }),
		);
		expect(mockCreateOrGetActiveResumeIntent).toHaveBeenCalled();
	});

	it("blocks viewer ACL from approval authority", async () => {
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "active",
			visibility: "shared",
			createdBy: "owner-1",
			repoId: "repo-1",
		});
		mockGetSessionAclRole.mockResolvedValue("viewer");

		await expect(
			assertApprovalAuthority({
				sessionId: "session-1",
				organizationId: "org-1",
				userId: "user-1",
			}),
		).rejects.toBeInstanceOf(ApprovalAuthorityError);
	});
});
