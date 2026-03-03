import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateInvocation,
	mockListPendingBySession,
	mockResolveMode,
	mockGetSessionCapabilityMode,
	mockSetSessionOperatorStatus,
	mockCreateActionInvocationEvent,
	mockGetInvocation,
	mockGetInvocationById,
	mockGetSessionApprovalContext,
	mockListExpirablePendingInvocations,
	mockGetSessionAclRole,
	mockWithTransaction,
	mockTransitionInvocationStatusTx,
	mockInsertInvocationEventTx,
	mockTouchSessionLastVisibleUpdate,
	mockFindActiveResumeIntentTx,
	mockInsertResumeIntentTx,
	mockGetSessionOperatorStatusTx,
} = vi.hoisted(() => ({
	mockCreateInvocation: vi.fn(),
	mockListPendingBySession: vi.fn(),
	mockResolveMode: vi.fn(),
	mockGetSessionCapabilityMode: vi.fn(),
	mockSetSessionOperatorStatus: vi.fn(),
	mockCreateActionInvocationEvent: vi.fn(),
	mockGetInvocation: vi.fn(),
	mockGetInvocationById: vi.fn(),
	mockGetSessionApprovalContext: vi.fn(),
	mockListExpirablePendingInvocations: vi.fn(),
	mockGetSessionAclRole: vi.fn(),
	mockWithTransaction: vi.fn(),
	mockTransitionInvocationStatusTx: vi.fn(),
	mockInsertInvocationEventTx: vi.fn(),
	mockTouchSessionLastVisibleUpdate: vi.fn(),
	mockFindActiveResumeIntentTx: vi.fn(),
	mockInsertResumeIntentTx: vi.fn(),
	mockGetSessionOperatorStatusTx: vi.fn(),
}));

vi.mock("./db", () => ({
	createInvocation: mockCreateInvocation,
	getInvocation: mockGetInvocation,
	getInvocationById: mockGetInvocationById,
	transitionInvocationStatus: vi.fn(),
	listBySession: vi.fn().mockResolvedValue([]),
	listPendingBySession: mockListPendingBySession,
	listExpirablePendingInvocations: mockListExpirablePendingInvocations,
	listByOrg: vi.fn().mockResolvedValue([]),
	countByOrg: vi.fn().mockResolvedValue(0),
	getSessionCapabilityMode: mockGetSessionCapabilityMode,
	setSessionOperatorStatus: mockSetSessionOperatorStatus,
	createActionInvocationEvent: mockCreateActionInvocationEvent,
	getSessionApprovalContext: mockGetSessionApprovalContext,
	createOrGetActiveResumeIntent: vi.fn(),
	getSessionAclRole: mockGetSessionAclRole,
	withTransaction: mockWithTransaction,
	transitionInvocationStatusTx: mockTransitionInvocationStatusTx,
	insertInvocationEventTx: mockInsertInvocationEventTx,
	touchSessionLastVisibleUpdate: mockTouchSessionLastVisibleUpdate,
	findActiveResumeIntentTx: mockFindActiveResumeIntentTx,
	insertResumeIntentTx: mockInsertResumeIntentTx,
	getSessionOperatorStatusTx: mockGetSessionOperatorStatusTx,
	isDuplicateActiveResumeIntentError: (error: unknown) =>
		error instanceof Error &&
		(error.message.includes("uq_resume_intents_one_active") ||
			error.message.includes("duplicate key value")),
	APPROVAL_RESOLUTION_STATUSES: new Set(["approved", "denied", "expired"]),
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
		updatedAt: new Date(),
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
		// withTransaction executes the callback with a fake tx object
		mockWithTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
		mockTransitionInvocationStatusTx.mockResolvedValue(undefined);
		mockInsertInvocationEventTx.mockResolvedValue(undefined);
		mockTouchSessionLastVisibleUpdate.mockResolvedValue(undefined);
		mockFindActiveResumeIntentTx.mockResolvedValue(undefined);
		mockInsertResumeIntentTx.mockResolvedValue(undefined);
		mockGetSessionOperatorStatusTx.mockResolvedValue(null);
	});

	it("requires approval for write actions and sets waiting status", async () => {
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

	it("writes denied transition atomically with resume payload", async () => {
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
		const deniedRow = makeInvocationRow({ status: "denied", mode: "require_approval" });
		mockTransitionInvocationStatusTx.mockResolvedValue(deniedRow);
		mockGetSessionOperatorStatusTx.mockResolvedValue("waiting_for_approval");
		mockInsertResumeIntentTx.mockResolvedValue({ id: "resume-1" });

		await denyAction("inv-1", "org-1", "user-1");

		expect(mockTransitionInvocationStatusTx).toHaveBeenCalledWith(
			expect.anything(),
			"inv-1",
			["pending"],
			"denied",
			expect.objectContaining({ completedAt: expect.any(Date) }),
		);
		expect(mockInsertInvocationEventTx).toHaveBeenCalledWith(
			expect.anything(),
			deniedRow.id,
			expect.objectContaining({ eventType: "denied" }),
		);
		expect(mockTouchSessionLastVisibleUpdate).toHaveBeenCalledWith(
			expect.anything(),
			deniedRow.sessionId,
		);
	});

	it("writes completed transition atomically with terminal side effects", async () => {
		mockGetInvocationById.mockResolvedValue(
			makeInvocationRow({ status: "executing", mode: "require_approval" }),
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
		const completedRow = makeInvocationRow({ status: "completed", mode: "require_approval" });
		mockTransitionInvocationStatusTx.mockResolvedValue(completedRow);
		mockGetSessionOperatorStatusTx.mockResolvedValue("waiting_for_approval");
		mockInsertResumeIntentTx.mockResolvedValue({ id: "resume-1" });

		await markCompleted("inv-1", { ok: true }, 12);

		expect(mockTransitionInvocationStatusTx).toHaveBeenCalledWith(
			expect.anything(),
			"inv-1",
			["executing"],
			"completed",
			expect.objectContaining({
				completedAt: expect.any(Date),
				durationMs: 12,
			}),
		);
		expect(mockInsertInvocationEventTx).toHaveBeenCalledWith(
			expect.anything(),
			completedRow.id,
			expect.objectContaining({ eventType: "completed" }),
		);
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
		const deniedRow = makeInvocationRow({ status: "denied", mode: "require_approval" });
		mockTransitionInvocationStatusTx.mockResolvedValue(deniedRow);
		mockGetSessionOperatorStatusTx.mockResolvedValue("waiting_for_approval");
		mockInsertResumeIntentTx.mockResolvedValue({ id: "resume-1" });

		await expect(approveAction("inv-1", "org-1", "approver-1")).rejects.toBeInstanceOf(
			ActionConflictError,
		);
		expect(mockTransitionInvocationStatusTx).toHaveBeenCalledWith(
			expect.anything(),
			"inv-1",
			["pending"],
			"denied",
			expect.objectContaining({
				deniedReason: "policy_revalidated_deny",
			}),
		);
	});

	it("blocks editor ACL from approval authority", async () => {
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "active",
			visibility: "shared",
			createdBy: "owner-1",
			repoId: "repo-1",
		});
		mockGetSessionAclRole.mockResolvedValue("editor");

		await expect(
			assertApprovalAuthority({
				sessionId: "session-1",
				organizationId: "org-1",
				userId: "user-1",
				isOrgAdmin: false,
			}),
		).rejects.toBeInstanceOf(ApprovalAuthorityError);
	});

	it("blocks implicit org viewers without explicit reviewer ACL", async () => {
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "active",
			visibility: "org",
			createdBy: "owner-1",
			repoId: "repo-1",
		});
		mockGetSessionAclRole.mockResolvedValue(undefined);

		await expect(
			assertApprovalAuthority({
				sessionId: "session-1",
				organizationId: "org-1",
				userId: "user-1",
				isOrgAdmin: false,
			}),
		).rejects.toBeInstanceOf(ApprovalAuthorityError);
	});

	it("allows explicit reviewer ACL", async () => {
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "active",
			visibility: "org",
			createdBy: "owner-1",
			repoId: "repo-1",
		});
		mockGetSessionAclRole.mockResolvedValue("reviewer");

		await expect(
			assertApprovalAuthority({
				sessionId: "session-1",
				organizationId: "org-1",
				userId: "reviewer-1",
				isOrgAdmin: false,
			}),
		).resolves.toBeUndefined();
	});

	it("allows session creator without explicit ACL", async () => {
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "active",
			visibility: "shared",
			createdBy: "creator-1",
			repoId: "repo-1",
		});

		await expect(
			assertApprovalAuthority({
				sessionId: "session-1",
				organizationId: "org-1",
				userId: "creator-1",
				isOrgAdmin: false,
			}),
		).resolves.toBeUndefined();

		expect(mockGetSessionAclRole).not.toHaveBeenCalled();
	});

	it("allows org-admin override without ACL row", async () => {
		mockGetSessionApprovalContext.mockResolvedValue({
			id: "session-1",
			organizationId: "org-1",
			automationId: null,
			operatorStatus: "active",
			visibility: "shared",
			createdBy: "owner-1",
			repoId: "repo-1",
		});

		await expect(
			assertApprovalAuthority({
				sessionId: "session-1",
				organizationId: "org-1",
				userId: "admin-1",
				isOrgAdmin: true,
			}),
		).resolves.toBeUndefined();
	});
});
