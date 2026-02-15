/**
 * Actions HTTP route tests.
 *
 * Covers approve/deny endpoints:
 *   - approve once (only mode — grants removed in vNext)
 *   - role gating (admin/owner required)
 *   - status/error mapping (404/409/410)
 */

import { type Server, createServer } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mocks
// ============================================

const mockApproveAction = vi.fn();
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
	},
	sessions: {
		findByIdInternal: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
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
	// POST /invocations/:id/approve
	// ------------------------------------------

	describe("POST /invocations/:id/approve", () => {
		it("approves a pending invocation and executes it", async () => {
			const invocation = makeInvocation();
			mockApproveAction.mockResolvedValue(invocation);
			mockMarkExecuting.mockResolvedValue(invocation);
			mockGetAdapter.mockReturnValue({
				execute: vi.fn().mockResolvedValue({ issueId: "LIN-123" }),
			});
			mockMarkCompleted.mockResolvedValue({ ...invocation, status: "completed" });

			const res = await jsonPost("/invocations/inv-1/approve", {});

			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.result).toEqual({ issueId: "LIN-123" });
			expect(mockApproveAction).toHaveBeenCalledWith("inv-1", "org-1", "user-1");
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
});
