/**
 * Actions HTTP route tests.
 *
 * Covers approve/deny endpoints:
 *   - approve once vs approve with grant modes
 *   - role gating (admin/owner required)
 *   - status/error mapping (404/409/410/400)
 *   - grant.maxCalls validation (positive int or null)
 */

import { type Server, createServer } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mocks
// ============================================

const mockApproveAction = vi.fn();
const mockApproveActionWithGrant = vi.fn();
const mockDenyAction = vi.fn();
const mockMarkExecuting = vi.fn();
const mockMarkCompleted = vi.fn();
const mockMarkFailed = vi.fn();
const mockGetAdapter = vi.fn();
const mockListSessionActions = vi.fn();
const mockGetActionStatus = vi.fn();

class ActionNotFoundError extends Error {
	constructor(msg = "Invocation not found") {
		super(msg);
		this.name = "ActionNotFoundError";
	}
}
class ActionExpiredError extends Error {
	constructor(msg = "Invocation has expired") {
		super(msg);
		this.name = "ActionExpiredError";
	}
}
class ActionConflictError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = "ActionConflictError";
	}
}

vi.mock("@proliferate/services", () => ({
	actions: {
		approveAction: (...args: unknown[]) => mockApproveAction(...args),
		approveActionWithGrant: (...args: unknown[]) => mockApproveActionWithGrant(...args),
		denyAction: (...args: unknown[]) => mockDenyAction(...args),
		markExecuting: (...args: unknown[]) => mockMarkExecuting(...args),
		markCompleted: (...args: unknown[]) => mockMarkCompleted(...args),
		markFailed: (...args: unknown[]) => mockMarkFailed(...args),
		getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
		listSessionActions: (...args: unknown[]) => mockListSessionActions(...args),
		getActionStatus: (...args: unknown[]) => mockGetActionStatus(...args),
		ActionNotFoundError,
		ActionExpiredError,
		ActionConflictError,
		invokeAction: vi.fn(),
		PendingLimitError: class extends Error {},
		createGrant: vi.fn(),
		listActiveGrants: vi.fn().mockResolvedValue([]),
	},
	sessions: {
		findByIdInternal: vi.fn().mockResolvedValue({ organizationId: "org-1", createdBy: "user-1" }),
		listSessionConnections: vi.fn().mockResolvedValue([
			{
				integrationId: "int-1",
				integration: {
					id: "int-1",
					integrationId: "linear",
					status: "active",
					provider: "nango",
					connectionId: "conn-1",
					githubInstallationId: null,
					displayName: "Linear",
				},
			},
		]),
	},
	orgs: {
		getUserRole: vi.fn().mockResolvedValue("owner"),
	},
	integrations: {
		getToken: vi.fn().mockResolvedValue("mock-token"),
	},
}));

vi.mock("@proliferate/logger", () => ({
	createLogger: () => ({
		child: () => ({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		}),
	}),
}));

// Import after mocks
const { createActionsRouter } = await import("./actions");
const { errorHandler } = await import("../../../middleware/error-handler");
const { orgs } = await import("@proliferate/services");

// ============================================
// Test helpers
// ============================================

function makeInvocation(overrides: Record<string, unknown> = {}) {
	return {
		id: "inv-1",
		sessionId: "session-1",
		organizationId: "org-1",
		integrationId: "int-1",
		integration: "linear",
		action: "create_issue",
		riskLevel: "write",
		status: "approved",
		params: { title: "Bug" },
		approvedBy: "user-1",
		approvedAt: new Date(),
		expiresAt: null,
		result: null,
		error: null,
		completedAt: null,
		durationMs: null,
		createdAt: new Date(),
		...overrides,
	};
}

function makeGrant(overrides: Record<string, unknown> = {}) {
	return {
		id: "grant-1",
		organizationId: "org-1",
		createdBy: "user-1",
		sessionId: "session-1",
		integration: "linear",
		action: "create_issue",
		maxCalls: null,
		usedCalls: 0,
		expiresAt: null,
		revokedAt: null,
		createdAt: new Date(),
		...overrides,
	};
}

// ============================================
// Setup
// ============================================

let server: Server;
let port: number;

function buildApp() {
	const app = express();
	app.use(express.json());

	// Inject mock auth
	app.use("/:proliferateSessionId/actions", (req, _res, next) => {
		req.auth = ((req as unknown as { _testAuth?: unknown })
			._testAuth as Express.Request["auth"]) ?? {
			userId: "user-1",
			orgId: "org-1",
			source: "jwt" as const,
		};
		next();
	});

	const mockHubManager = {
		getOrCreate: vi.fn().mockResolvedValue({
			broadcastMessage: vi.fn(),
		}),
		get: vi.fn(),
		remove: vi.fn(),
		getActiveSessionIds: vi.fn().mockReturnValue([]),
	};
	const mockEnv = {} as never;

	app.use("/:proliferateSessionId/actions", createActionsRouter(mockEnv, mockHubManager as never));
	app.use(errorHandler);

	return app;
}

async function startServer() {
	const app = buildApp();
	server = createServer(app);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") throw new Error("No addr");
	port = addr.port;
}

function url(path: string) {
	return `http://127.0.0.1:${port}/session-1/actions${path}`;
}

function jsonPost(path: string, body: unknown) {
	return fetch(url(path), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

// ============================================
// Tests
// ============================================

describe("actions HTTP routes", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		await startServer();
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	// ------------------------------------------
	// POST /invocations/:id/approve — approve once
	// ------------------------------------------

	describe("POST /invocations/:id/approve (once mode)", () => {
		it("approves a pending invocation and executes it", async () => {
			const invocation = makeInvocation();
			mockApproveAction.mockResolvedValue(invocation);
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ issueId: "LIN-123" }),
			});
			mockMarkCompleted.mockResolvedValue({ ...invocation, status: "completed" });

			const res = await jsonPost("/invocations/inv-1/approve", { mode: "once" });

			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.result).toEqual({ issueId: "LIN-123" });
			expect(mockApproveAction).toHaveBeenCalledWith("inv-1", "org-1", "user-1");
		});

		it("defaults to once mode when mode is omitted", async () => {
			const invocation = makeInvocation();
			mockApproveAction.mockResolvedValue(invocation);
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue({ ...invocation, status: "completed" });

			const res = await jsonPost("/invocations/inv-1/approve", {});

			expect(res.status).toBe(200);
			expect(mockApproveAction).toHaveBeenCalled();
			expect(mockApproveActionWithGrant).not.toHaveBeenCalled();
		});
	});

	// ------------------------------------------
	// POST /invocations/:id/approve — grant mode
	// ------------------------------------------

	describe("POST /invocations/:id/approve (grant mode)", () => {
		it("approves with grant and returns grant info", async () => {
			const invocation = makeInvocation();
			const grant = makeGrant();
			mockApproveActionWithGrant.mockResolvedValue({ invocation, grant });
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue({ ...invocation, status: "completed" });

			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { scope: "session", maxCalls: 5 },
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.grant).toEqual({
				id: "grant-1",
				integration: "linear",
				action: "create_issue",
				maxCalls: null,
			});
			expect(mockApproveActionWithGrant).toHaveBeenCalledWith("inv-1", "org-1", "user-1", {
				scope: "session",
				maxCalls: 5,
			});
		});

		it("accepts org scope", async () => {
			const invocation = makeInvocation();
			const grant = makeGrant({ sessionId: null });
			mockApproveActionWithGrant.mockResolvedValue({ invocation, grant });
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue({ ...invocation, status: "completed" });

			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { scope: "org", maxCalls: null },
			});

			expect(res.status).toBe(200);
			expect(mockApproveActionWithGrant).toHaveBeenCalledWith("inv-1", "org-1", "user-1", {
				scope: "org",
				maxCalls: null,
			});
		});

		it("defaults scope to session when not specified", async () => {
			const invocation = makeInvocation();
			const grant = makeGrant();
			mockApproveActionWithGrant.mockResolvedValue({ invocation, grant });
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue({ ...invocation, status: "completed" });

			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: {},
			});

			expect(res.status).toBe(200);
			expect(mockApproveActionWithGrant).toHaveBeenCalledWith("inv-1", "org-1", "user-1", {
				scope: "session",
				maxCalls: null,
			});
		});
	});

	// ------------------------------------------
	// grant.maxCalls validation
	// ------------------------------------------

	describe("grant.maxCalls validation", () => {
		it("rejects maxCalls=0", async () => {
			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { maxCalls: 0 },
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/positive integer/i);
		});

		it("rejects negative maxCalls", async () => {
			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { maxCalls: -3 },
			});
			expect(res.status).toBe(400);
		});

		it("rejects non-integer maxCalls", async () => {
			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { maxCalls: 2.5 },
			});
			expect(res.status).toBe(400);
		});

		it("accepts null maxCalls (unlimited)", async () => {
			const invocation = makeInvocation();
			const grant = makeGrant({ maxCalls: null });
			mockApproveActionWithGrant.mockResolvedValue({ invocation, grant });
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue(invocation);

			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { scope: "session", maxCalls: null },
			});
			expect(res.status).toBe(200);
		});

		it("accepts positive integer maxCalls", async () => {
			const invocation = makeInvocation();
			const grant = makeGrant({ maxCalls: 10 });
			mockApproveActionWithGrant.mockResolvedValue({ invocation, grant });
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue(invocation);

			const res = await jsonPost("/invocations/inv-1/approve", {
				mode: "grant",
				grant: { maxCalls: 10 },
			});
			expect(res.status).toBe(200);
		});
	});

	// ------------------------------------------
	// Invalid approval mode
	// ------------------------------------------

	describe("invalid approval mode", () => {
		it("rejects unknown mode", async () => {
			const res = await jsonPost("/invocations/inv-1/approve", { mode: "bulk" });
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/Invalid approval mode/);
		});
	});

	// ------------------------------------------
	// Error status mapping
	// ------------------------------------------

	describe("error status mapping", () => {
		it("returns 404 for ActionNotFoundError", async () => {
			mockApproveAction.mockRejectedValue(new ActionNotFoundError());

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(404);
		});

		it("returns 410 for ActionExpiredError", async () => {
			mockApproveAction.mockRejectedValue(new ActionExpiredError());

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(410);
		});

		it("returns 409 for ActionConflictError", async () => {
			mockApproveAction.mockRejectedValue(
				new ActionConflictError("Cannot approve invocation in status: completed"),
			);

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(409);
		});

		it("returns 404 on deny for ActionNotFoundError", async () => {
			mockDenyAction.mockRejectedValue(new ActionNotFoundError());

			const res = await jsonPost("/invocations/inv-1/deny", {});
			expect(res.status).toBe(404);
		});

		it("returns 409 on deny for ActionConflictError", async () => {
			mockDenyAction.mockRejectedValue(
				new ActionConflictError("Cannot deny invocation in status: approved"),
			);

			const res = await jsonPost("/invocations/inv-1/deny", {});
			expect(res.status).toBe(409);
		});
	});

	// ------------------------------------------
	// Role gating
	// ------------------------------------------

	describe("role gating", () => {
		it("returns 403 for member role", async () => {
			vi.mocked(orgs.getUserRole).mockResolvedValueOnce("member");

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/Admin or owner role required/);
		});

		it("allows admin role", async () => {
			vi.mocked(orgs.getUserRole).mockResolvedValueOnce("admin");
			const invocation = makeInvocation();
			mockApproveAction.mockResolvedValue(invocation);
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue(invocation);

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(200);
		});

		it("allows owner role", async () => {
			vi.mocked(orgs.getUserRole).mockResolvedValueOnce("owner");
			const invocation = makeInvocation();
			mockApproveAction.mockResolvedValue(invocation);
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ ok: true }),
			});
			mockMarkCompleted.mockResolvedValue(invocation);

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(200);
		});

		it("requires user auth (rejects sandbox tokens) for approve", async () => {
			// Build a one-off app with sandbox auth
			const app = express();
			app.use(express.json());
			app.use("/:proliferateSessionId/actions", (req, _res, next) => {
				req.auth = { source: "sandbox" as const, sessionId: "session-1" };
				next();
			});
			const mockHubManager = {
				getOrCreate: vi.fn().mockResolvedValue({ broadcastMessage: vi.fn() }),
				get: vi.fn(),
				remove: vi.fn(),
				getActiveSessionIds: vi.fn().mockReturnValue([]),
			};
			app.use(
				"/:proliferateSessionId/actions",
				createActionsRouter({} as never, mockHubManager as never),
			);
			app.use(errorHandler);

			const srv = createServer(app);
			await new Promise<void>((r) => srv.listen(0, r));
			const addr = srv.address();
			if (!addr || typeof addr === "string") throw new Error("No addr");

			const res = await fetch(
				`http://127.0.0.1:${addr.port}/session-1/actions/invocations/inv-1/approve`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);

			expect(res.status).toBe(401);

			await new Promise<void>((resolve, reject) => {
				srv.close((err) => (err ? reject(err) : resolve()));
			});
		});
	});

	// ------------------------------------------
	// POST /invocations/:id/deny
	// ------------------------------------------

	describe("POST /invocations/:id/deny", () => {
		it("denies a pending invocation", async () => {
			const invocation = makeInvocation({ status: "denied" });
			mockDenyAction.mockResolvedValue(invocation);

			const res = await jsonPost("/invocations/inv-1/deny", {});
			expect(res.status).toBe(200);
			const body = (await res.json()) as { invocation: { status: string } };
			expect(body.invocation.status).toBe("denied");
			expect(mockDenyAction).toHaveBeenCalledWith("inv-1", "org-1", "user-1");
		});

		it("requires admin role for deny", async () => {
			vi.mocked(orgs.getUserRole).mockResolvedValueOnce("member");

			const res = await jsonPost("/invocations/inv-1/deny", {});
			expect(res.status).toBe(403);
		});
	});

	// ------------------------------------------
	// Execution failure after approval
	// ------------------------------------------

	describe("execution failure after approval", () => {
		it("returns 502 when adapter execution fails", async () => {
			const invocation = makeInvocation();
			mockApproveAction.mockResolvedValue(invocation);
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockRejectedValue(new Error("API rate limited")),
			});
			mockMarkFailed.mockResolvedValue({ ...invocation, status: "failed" });

			const res = await jsonPost("/invocations/inv-1/approve", {});
			expect(res.status).toBe(502);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/API rate limited/);
		});
	});

	// ------------------------------------------
	// POST /grants — sandbox grant creation identity
	// ------------------------------------------

	describe("POST /grants (sandbox grant creation)", () => {
		it("uses session.createdBy (userId) as grant creator, not sessionId", async () => {
			const { sessions, actions: actionsService } = await import("@proliferate/services");
			vi.mocked(sessions.findByIdInternal).mockResolvedValueOnce({
				organizationId: "org-1",
				createdBy: "user-owner-1",
			} as never);
			vi.mocked(actionsService.createGrant).mockResolvedValueOnce(
				makeGrant({ createdBy: "user-owner-1" }) as never,
			);

			// Build sandbox-auth app
			const sandboxApp = express();
			sandboxApp.use(express.json());
			sandboxApp.use("/:proliferateSessionId/actions", (req, _res, next) => {
				req.auth = { source: "sandbox" as const, sessionId: "session-1" };
				next();
			});
			const mockHub = {
				getOrCreate: vi.fn().mockResolvedValue({ broadcastMessage: vi.fn() }),
				get: vi.fn(),
				remove: vi.fn(),
				getActiveSessionIds: vi.fn().mockReturnValue([]),
			};
			sandboxApp.use(
				"/:proliferateSessionId/actions",
				createActionsRouter({} as never, mockHub as never),
			);
			sandboxApp.use(errorHandler);

			const srv = createServer(sandboxApp);
			await new Promise<void>((r) => srv.listen(0, r));
			const addr = srv.address();
			if (!addr || typeof addr === "string") throw new Error("No addr");

			const res = await fetch(`http://127.0.0.1:${addr.port}/session-1/actions/grants`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ integration: "linear", action: "create_issue" }),
			});

			expect(res.status).toBe(201);
			expect(vi.mocked(actionsService.createGrant)).toHaveBeenCalledWith(
				expect.objectContaining({ createdBy: "user-owner-1" }),
			);

			await new Promise<void>((resolve, reject) => {
				srv.close((err) => (err ? reject(err) : resolve()));
			});
		});

		it("returns 400 when session has no owner identity", async () => {
			const { sessions } = await import("@proliferate/services");
			vi.mocked(sessions.findByIdInternal).mockResolvedValueOnce({
				organizationId: "org-1",
				createdBy: null,
			} as never);

			// Build sandbox-auth app
			const sandboxApp = express();
			sandboxApp.use(express.json());
			sandboxApp.use("/:proliferateSessionId/actions", (req, _res, next) => {
				req.auth = { source: "sandbox" as const, sessionId: "session-1" };
				next();
			});
			const mockHub = {
				getOrCreate: vi.fn().mockResolvedValue({ broadcastMessage: vi.fn() }),
				get: vi.fn(),
				remove: vi.fn(),
				getActiveSessionIds: vi.fn().mockReturnValue([]),
			};
			sandboxApp.use(
				"/:proliferateSessionId/actions",
				createActionsRouter({} as never, mockHub as never),
			);
			sandboxApp.use(errorHandler);

			const srv = createServer(sandboxApp);
			await new Promise<void>((r) => srv.listen(0, r));
			const addr = srv.address();
			if (!addr || typeof addr === "string") throw new Error("No addr");

			const res = await fetch(`http://127.0.0.1:${addr.port}/session-1/actions/grants`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ integration: "linear", action: "create_issue" }),
			});

			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/no owner identity/);

			await new Promise<void>((resolve, reject) => {
				srv.close((err) => (err ? reject(err) : resolve()));
			});
		});
	});
});
