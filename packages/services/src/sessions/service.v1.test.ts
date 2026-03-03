import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockCreateTaskSession,
	mockFindSessionById,
	mockEnqueueSessionMessage,
	mockFindTerminalFollowupMessageByDedupe,
	mockFindLatestTerminalFollowupSession,
	mockClaimDeliverableSessionMessages,
	mockTransitionSessionMessageDeliveryState,
	mockPersistSessionOutcome,
	mockGetSessionOutcome,
	mockGetSessionAclRole,
	mockGrantSessionAcl,
	mockUpdateSessionVisibility,
	mockUpsertSessionUserState,
	mockArchiveSession,
	mockUnarchiveSession,
	mockSoftDeleteSession,
} = vi.hoisted(() => ({
	mockCreateTaskSession: vi.fn(),
	mockFindSessionById: vi.fn(),
	mockEnqueueSessionMessage: vi.fn(),
	mockFindTerminalFollowupMessageByDedupe: vi.fn(),
	mockFindLatestTerminalFollowupSession: vi.fn(),
	mockClaimDeliverableSessionMessages: vi.fn(),
	mockTransitionSessionMessageDeliveryState: vi.fn(),
	mockPersistSessionOutcome: vi.fn(),
	mockGetSessionOutcome: vi.fn(),
	mockGetSessionAclRole: vi.fn(),
	mockGrantSessionAcl: vi.fn(),
	mockUpdateSessionVisibility: vi.fn(),
	mockUpsertSessionUserState: vi.fn(),
	mockArchiveSession: vi.fn(),
	mockUnarchiveSession: vi.fn(),
	mockSoftDeleteSession: vi.fn(),
}));

vi.mock("./db", () => ({
	createTaskSession: mockCreateTaskSession,
	findSessionById: mockFindSessionById,
	enqueueSessionMessage: mockEnqueueSessionMessage,
	findTerminalFollowupMessageByDedupe: mockFindTerminalFollowupMessageByDedupe,
	findLatestTerminalFollowupSession: mockFindLatestTerminalFollowupSession,
	claimDeliverableSessionMessages: mockClaimDeliverableSessionMessages,
	transitionSessionMessageDeliveryState: mockTransitionSessionMessageDeliveryState,
	persistSessionOutcome: mockPersistSessionOutcome,
	getSessionOutcome: mockGetSessionOutcome,
	getSessionAclRole: mockGetSessionAclRole,
	grantSessionAcl: mockGrantSessionAcl,
	updateSessionVisibility: mockUpdateSessionVisibility,
	upsertSessionUserState: mockUpsertSessionUserState,
	archiveSession: mockArchiveSession,
	unarchiveSession: mockUnarchiveSession,
	softDeleteSession: mockSoftDeleteSession,
}));

const {
	SessionAccessDeniedError,
	SessionKindError,
	SessionNotFoundError,
	SessionRuntimeStatusError,
	assertSessionAccess,
	claimQueuedSessionMessagesForDelivery,
	getSessionAccessRole,
	grantSessionAccess,
	markSessionMessageConsumed,
	markSessionViewed,
	persistTerminalTaskOutcome,
	sendTaskFollowup,
	archiveSession,
	softDeleteSession,
} = await import("./service");

function makeTaskSession(overrides: Record<string, unknown> = {}) {
	return {
		id: "task-1",
		organizationId: "org-1",
		createdBy: "user-1",
		sessionType: "coding",
		kind: "task",
		status: "running",
		runtimeStatus: "running",
		operatorStatus: "active",
		visibility: "private",
		repoId: "repo-1",
		repoBaselineId: "baseline-1",
		repoBaselineTargetId: "target-1",
		workerId: "worker-1",
		workerRunId: "run-1",
		parentSessionId: null,
		continuedFromSessionId: null,
		rerunOfSessionId: null,
		configurationId: null,
		initialPrompt: null,
		title: null,
		titleStatus: null,
		sandboxProvider: "modal",
		sandboxId: null,
		snapshotId: null,
		branchName: null,
		baseCommitSha: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makeSessionMessage(overrides: Record<string, unknown> = {}) {
	return {
		id: "msg-1",
		sessionId: "task-1",
		direction: "user_to_task",
		messageType: "follow_up",
		payloadJson: { text: "hi" },
		deliveryState: "queued",
		dedupeKey: null,
		queuedAt: new Date(),
		deliverAfter: null,
		deliveredAt: null,
		consumedAt: null,
		failedAt: null,
		failureReason: null,
		senderUserId: "user-1",
		senderSessionId: null,
		...overrides,
	};
}

describe("sessions service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindTerminalFollowupMessageByDedupe.mockResolvedValue(undefined);
		mockFindLatestTerminalFollowupSession.mockResolvedValue(undefined);
	});

	it("keeps follow-up in same live task session", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "running" }));
		mockEnqueueSessionMessage.mockResolvedValue(makeSessionMessage({ sessionId: "task-1" }));

		const result = await sendTaskFollowup({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
			messageType: "follow_up",
			payloadJson: { text: "continue" },
		});

		expect(result.mode).toBe("same_session");
		expect(result.deliverySessionId).toBe("task-1");
		expect(mockCreateTaskSession).not.toHaveBeenCalled();
	});

	it("creates ad-hoc continuation follow-up for terminal completed task", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "completed" }));
		mockCreateTaskSession.mockResolvedValue(
			makeTaskSession({ id: "task-2", workerId: null, workerRunId: null }),
		);
		mockEnqueueSessionMessage.mockResolvedValue(makeSessionMessage({ sessionId: "task-2" }));

		const result = await sendTaskFollowup({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
			messageType: "follow_up",
			payloadJson: { text: "next iteration" },
		});

		expect(result.mode).toBe("continuation");
		expect(result.deliverySessionId).toBe("task-2");
		expect(mockCreateTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				continuedFromSessionId: "task-1",
				rerunOfSessionId: null,
				workerId: null,
				workerRunId: null,
			}),
		);
	});

	it("creates ad-hoc continuation follow-up for terminal failed task by default", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "failed" }));
		mockCreateTaskSession.mockResolvedValue(
			makeTaskSession({ id: "task-3", workerId: null, workerRunId: null }),
		);
		mockEnqueueSessionMessage.mockResolvedValue(makeSessionMessage({ sessionId: "task-3" }));

		const result = await sendTaskFollowup({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
			messageType: "follow_up",
			payloadJson: { text: "retry" },
		});

		expect(result.mode).toBe("continuation");
		expect(result.deliverySessionId).toBe("task-3");
		expect(mockCreateTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				continuedFromSessionId: "task-1",
				rerunOfSessionId: null,
				workerId: null,
				workerRunId: null,
			}),
		);
	});

	it("creates ad-hoc rerun follow-up only when explicitly requested", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "failed" }));
		mockCreateTaskSession.mockResolvedValue(
			makeTaskSession({ id: "task-4", workerId: null, workerRunId: null }),
		);
		mockEnqueueSessionMessage.mockResolvedValue(makeSessionMessage({ sessionId: "task-4" }));

		const result = await sendTaskFollowup({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
			messageType: "follow_up",
			payloadJson: { text: "retry" },
			terminalMode: "rerun",
		});

		expect(result.mode).toBe("rerun");
		expect(result.deliverySessionId).toBe("task-4");
		expect(mockCreateTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				continuedFromSessionId: null,
				rerunOfSessionId: "task-1",
			}),
		);
	});

	it("reuses existing terminal follow-up delivery when dedupe key matches", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "completed" }));
		mockFindTerminalFollowupMessageByDedupe.mockResolvedValue({
			deliverySessionId: "task-2",
			sessionMessage: makeSessionMessage({ id: "msg-dedupe", sessionId: "task-2" }),
		});

		const result = await sendTaskFollowup({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
			messageType: "follow_up",
			payloadJson: { text: "next iteration" },
			dedupeKey: "dedupe-1",
		});

		expect(result.mode).toBe("continuation");
		expect(result.deliverySessionId).toBe("task-2");
		expect(result.sessionMessage.id).toBe("msg-dedupe");
		expect(mockCreateTaskSession).not.toHaveBeenCalled();
		expect(mockEnqueueSessionMessage).not.toHaveBeenCalled();
	});

	it("reuses existing terminal follow-up session before creating another child", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "completed" }));
		mockFindLatestTerminalFollowupSession.mockResolvedValue(
			makeTaskSession({ id: "task-existing", workerId: null, workerRunId: null }),
		);
		mockEnqueueSessionMessage.mockResolvedValue(
			makeSessionMessage({ id: "msg-existing", sessionId: "task-existing" }),
		);

		const result = await sendTaskFollowup({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
			messageType: "follow_up",
			payloadJson: { text: "retry delivery" },
			dedupeKey: "dedupe-existing-session",
		});

		expect(result.mode).toBe("continuation");
		expect(result.deliverySessionId).toBe("task-existing");
		expect(mockCreateTaskSession).not.toHaveBeenCalled();
		expect(mockEnqueueSessionMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "task-existing",
				dedupeKey: "dedupe-existing-session",
			}),
		);
	});

	it("rejects follow-up routing for non-task sessions", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ kind: "manager" }));

		await expect(
			sendTaskFollowup({
				sessionId: "task-1",
				organizationId: "org-1",
				userId: "user-1",
				messageType: "follow_up",
				payloadJson: { text: "x" },
			}),
		).rejects.toBeInstanceOf(SessionKindError);
	});

	it("persists terminal task outcome for completed sessions", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "completed" }));
		mockPersistSessionOutcome.mockResolvedValue({
			outcomeJson: { summary: "done" },
			outcomeVersion: 2,
			outcomePersistedAt: new Date(),
		});

		const outcome = await persistTerminalTaskOutcome({
			sessionId: "task-1",
			organizationId: "org-1",
			outcomeJson: { summary: "done" },
			outcomeVersion: 2,
		});

		expect(outcome.outcomeVersion).toBe(2);
		expect(mockPersistSessionOutcome).toHaveBeenCalledWith({
			sessionId: "task-1",
			outcomeJson: { summary: "done" },
			outcomeVersion: 2,
		});
	});

	it("rejects outcome persistence for non-terminal sessions", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ runtimeStatus: "running" }));

		await expect(
			persistTerminalTaskOutcome({
				sessionId: "task-1",
				organizationId: "org-1",
				outcomeJson: { summary: "x" },
			}),
		).rejects.toBeInstanceOf(SessionRuntimeStatusError);

		expect(mockPersistSessionOutcome).not.toHaveBeenCalled();
	});

	it("claims queued deliverable messages and marks delivered", async () => {
		mockClaimDeliverableSessionMessages.mockResolvedValue([makeSessionMessage({ id: "msg-2" })]);

		const rows = await claimQueuedSessionMessagesForDelivery("task-1", 10);

		expect(rows).toHaveLength(1);
		expect(mockClaimDeliverableSessionMessages).toHaveBeenCalledWith("task-1", 10);
	});

	it("marks delivered message as consumed", async () => {
		mockTransitionSessionMessageDeliveryState.mockResolvedValue(
			makeSessionMessage({ id: "msg-3", deliveryState: "consumed" }),
		);

		const row = await markSessionMessageConsumed("msg-3");

		expect(row?.deliveryState).toBe("consumed");
		expect(mockTransitionSessionMessageDeliveryState).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "msg-3",
				fromStates: ["delivered"],
				toState: "consumed",
			}),
		);
	});
});

describe("session ACL (K2)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 'owner' for session creator", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ createdBy: "user-1" }));
		mockGetSessionAclRole.mockResolvedValue(null);

		const role = await getSessionAccessRole({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-1",
		});

		expect(role).toBe("owner");
		expect(mockGetSessionAclRole).not.toHaveBeenCalled();
	});

	it("returns explicit ACL role for non-creator", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession({ createdBy: "user-1" }));
		mockGetSessionAclRole.mockResolvedValue("editor");

		const role = await getSessionAccessRole({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-2",
		});

		expect(role).toBe("editor");
	});

	it("returns 'viewer' for org-visible sessions with no explicit ACL", async () => {
		mockFindSessionById.mockResolvedValue(
			makeTaskSession({ createdBy: "user-1", visibility: "org" }),
		);
		mockGetSessionAclRole.mockResolvedValue(null);

		const role = await getSessionAccessRole({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-3",
		});

		expect(role).toBe("viewer");
	});

	it("returns null for private sessions with no ACL (access denied)", async () => {
		mockFindSessionById.mockResolvedValue(
			makeTaskSession({ createdBy: "user-1", visibility: "private" }),
		);
		mockGetSessionAclRole.mockResolvedValue(null);

		const role = await getSessionAccessRole({
			sessionId: "task-1",
			organizationId: "org-1",
			userId: "user-3",
		});

		expect(role).toBeNull();
	});

	it("assertSessionAccess throws for no access", async () => {
		mockFindSessionById.mockResolvedValue(
			makeTaskSession({ createdBy: "user-1", visibility: "private" }),
		);
		mockGetSessionAclRole.mockResolvedValue(null);

		await expect(
			assertSessionAccess({
				sessionId: "task-1",
				organizationId: "org-1",
				userId: "user-3",
			}),
		).rejects.toBeInstanceOf(SessionAccessDeniedError);
	});

	it("assertSessionAccess enforces role hierarchy", async () => {
		mockFindSessionById.mockResolvedValue(
			makeTaskSession({ createdBy: "user-1", visibility: "org" }),
		);
		mockGetSessionAclRole.mockResolvedValue(null);

		// user-3 gets "viewer" via org visibility — should fail when "editor" required
		await expect(
			assertSessionAccess({
				sessionId: "task-1",
				organizationId: "org-1",
				userId: "user-3",
				requiredRole: "editor",
			}),
		).rejects.toBeInstanceOf(SessionAccessDeniedError);
	});

	it("grantSessionAccess promotes private to shared", async () => {
		mockFindSessionById.mockResolvedValue(
			makeTaskSession({ createdBy: "user-1", visibility: "private" }),
		);
		mockGrantSessionAcl.mockResolvedValue(undefined);
		mockUpdateSessionVisibility.mockResolvedValue(undefined);

		await grantSessionAccess({
			sessionId: "task-1",
			organizationId: "org-1",
			targetUserId: "user-2",
			role: "editor",
			grantedBy: "user-1",
		});

		expect(mockGrantSessionAcl).toHaveBeenCalledWith({
			sessionId: "task-1",
			userId: "user-2",
			role: "editor",
			grantedBy: "user-1",
		});
		expect(mockUpdateSessionVisibility).toHaveBeenCalledWith("task-1", "shared");
	});

	it("grantSessionAccess does not change visibility for org-visible sessions", async () => {
		mockFindSessionById.mockResolvedValue(
			makeTaskSession({ createdBy: "user-1", visibility: "org" }),
		);
		mockGrantSessionAcl.mockResolvedValue(undefined);

		await grantSessionAccess({
			sessionId: "task-1",
			organizationId: "org-1",
			targetUserId: "user-2",
			role: "viewer",
			grantedBy: "user-1",
		});

		expect(mockUpdateSessionVisibility).not.toHaveBeenCalled();
	});
});

describe("markSessionViewed (K3)", () => {
	it("upserts session user state with lastViewedAt", async () => {
		mockUpsertSessionUserState.mockResolvedValue({});

		await markSessionViewed({ sessionId: "task-1", userId: "user-1" });

		expect(mockUpsertSessionUserState).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "task-1",
				userId: "user-1",
				lastViewedAt: expect.any(Date),
			}),
		);
	});
});

describe("archive and soft-delete (K6)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("archiveSession calls v1Db.archiveSession", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession());
		mockArchiveSession.mockResolvedValue(undefined);

		await archiveSession({ sessionId: "task-1", organizationId: "org-1", userId: "user-1" });

		expect(mockArchiveSession).toHaveBeenCalledWith("task-1", "user-1");
	});

	it("archiveSession throws for missing session", async () => {
		mockFindSessionById.mockResolvedValue(undefined);

		await expect(
			archiveSession({ sessionId: "missing", organizationId: "org-1", userId: "user-1" }),
		).rejects.toBeInstanceOf(SessionNotFoundError);
	});

	it("softDeleteSession calls v1Db.softDeleteSession", async () => {
		mockFindSessionById.mockResolvedValue(makeTaskSession());
		mockSoftDeleteSession.mockResolvedValue(undefined);

		await softDeleteSession({ sessionId: "task-1", organizationId: "org-1", userId: "user-1" });

		expect(mockSoftDeleteSession).toHaveBeenCalledWith("task-1", "user-1");
	});
});
