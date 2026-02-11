import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

const {
	mockCreateGrant,
	mockGetGrant,
	mockListActiveGrants,
	mockFindMatchingGrants,
	mockConsumeGrantCall,
	mockRevokeGrant,
	mockListGrantsByOrg,
} = vi.hoisted(() => ({
	mockCreateGrant: vi.fn(),
	mockGetGrant: vi.fn(),
	mockListActiveGrants: vi.fn(),
	mockFindMatchingGrants: vi.fn(),
	mockConsumeGrantCall: vi.fn(),
	mockRevokeGrant: vi.fn(),
	mockListGrantsByOrg: vi.fn(),
}));

vi.mock("./grants-db", () => ({
	createGrant: mockCreateGrant,
	getGrant: mockGetGrant,
	listActiveGrants: mockListActiveGrants,
	findMatchingGrants: mockFindMatchingGrants,
	consumeGrantCall: mockConsumeGrantCall,
	revokeGrant: mockRevokeGrant,
	listGrantsByOrg: mockListGrantsByOrg,
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

const { evaluateGrant, createGrant, revokeGrant, GrantNotFoundError } = await import("./grants");

// ============================================
// Test helpers
// ============================================

function makeGrant(overrides: Record<string, unknown> = {}) {
	return {
		id: "grant-1",
		organizationId: "org-1",
		createdBy: "user-1",
		sessionId: null,
		integration: "linear",
		action: "create_issue",
		maxCalls: 10,
		usedCalls: 0,
		expiresAt: null,
		revokedAt: null,
		createdAt: new Date(),
		...overrides,
	};
}

// ============================================
// Tests
// ============================================

describe("grants service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ------------------------------------------
	// evaluateGrant
	// ------------------------------------------

	describe("evaluateGrant", () => {
		it("returns granted=true when a matching grant exists", async () => {
			const grant = makeGrant();
			mockFindMatchingGrants.mockResolvedValue([grant]);
			mockConsumeGrantCall.mockResolvedValue({ ...grant, usedCalls: 1 });

			const result = await evaluateGrant("org-1", "linear", "create_issue");

			expect(result.granted).toBe(true);
			expect(result.grantId).toBe("grant-1");
			expect(mockConsumeGrantCall).toHaveBeenCalledWith("grant-1");
		});

		it("returns granted=false when no matching grants exist", async () => {
			mockFindMatchingGrants.mockResolvedValue([]);

			const result = await evaluateGrant("org-1", "linear", "create_issue");

			expect(result.granted).toBe(false);
			expect(result.grantId).toBeUndefined();
			expect(mockConsumeGrantCall).not.toHaveBeenCalled();
		});

		it("returns granted=false when all matching grants are exhausted at CAS time", async () => {
			const grant = makeGrant({ usedCalls: 10, maxCalls: 10 });
			mockFindMatchingGrants.mockResolvedValue([grant]);
			// CAS fails because grant was exhausted between find and consume
			mockConsumeGrantCall.mockResolvedValue(undefined);

			const result = await evaluateGrant("org-1", "linear", "create_issue");

			expect(result.granted).toBe(false);
			expect(mockConsumeGrantCall).toHaveBeenCalledTimes(1);
		});

		it("falls through to next candidate when first grant CAS fails", async () => {
			const grant1 = makeGrant({ id: "grant-1" });
			const grant2 = makeGrant({ id: "grant-2" });
			mockFindMatchingGrants.mockResolvedValue([grant1, grant2]);
			// First CAS fails, second succeeds
			mockConsumeGrantCall
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({ ...grant2, usedCalls: 1 });

			const result = await evaluateGrant("org-1", "linear", "create_issue");

			expect(result.granted).toBe(true);
			expect(result.grantId).toBe("grant-2");
			expect(mockConsumeGrantCall).toHaveBeenCalledTimes(2);
		});

		it("passes sessionId to findMatchingGrants when provided", async () => {
			mockFindMatchingGrants.mockResolvedValue([]);

			await evaluateGrant("org-1", "linear", "create_issue", "session-1");

			expect(mockFindMatchingGrants).toHaveBeenCalledWith(
				"org-1",
				"linear",
				"create_issue",
				"session-1",
			);
		});

		it("matches wildcard integration grant", async () => {
			const grant = makeGrant({ integration: "*", action: "*" });
			mockFindMatchingGrants.mockResolvedValue([grant]);
			mockConsumeGrantCall.mockResolvedValue({ ...grant, usedCalls: 1 });

			const result = await evaluateGrant("org-1", "sentry", "update_issue");

			expect(result.granted).toBe(true);
			// The wildcard matching is done in findMatchingGrants (DB query),
			// so we just verify it was called with the specific action
			expect(mockFindMatchingGrants).toHaveBeenCalledWith(
				"org-1",
				"sentry",
				"update_issue",
				undefined,
			);
		});

		it("handles unlimited grants (maxCalls=null)", async () => {
			const grant = makeGrant({ maxCalls: null, usedCalls: 999 });
			mockFindMatchingGrants.mockResolvedValue([grant]);
			mockConsumeGrantCall.mockResolvedValue({ ...grant, usedCalls: 1000 });

			const result = await evaluateGrant("org-1", "linear", "create_issue");

			expect(result.granted).toBe(true);
		});
	});

	// ------------------------------------------
	// Concurrency safety
	// ------------------------------------------

	describe("concurrency safety", () => {
		it("concurrent evaluations: only one wins per budget unit", async () => {
			const grant = makeGrant({ maxCalls: 1, usedCalls: 0 });
			mockFindMatchingGrants.mockResolvedValue([grant]);
			// Simulate CAS: first caller wins, second loses
			mockConsumeGrantCall
				.mockResolvedValueOnce({ ...grant, usedCalls: 1 })
				.mockResolvedValueOnce(undefined);

			const [r1, r2] = await Promise.all([
				evaluateGrant("org-1", "linear", "create_issue"),
				evaluateGrant("org-1", "linear", "create_issue"),
			]);

			const granted = [r1, r2].filter((r) => r.granted);
			const denied = [r1, r2].filter((r) => !r.granted);
			expect(granted).toHaveLength(1);
			expect(denied).toHaveLength(1);
		});

		it("three concurrent evaluations on budget=2: exactly two win", async () => {
			const grant = makeGrant({ maxCalls: 2, usedCalls: 0 });
			mockFindMatchingGrants.mockResolvedValue([grant]);
			mockConsumeGrantCall
				.mockResolvedValueOnce({ ...grant, usedCalls: 1 })
				.mockResolvedValueOnce({ ...grant, usedCalls: 2 })
				.mockResolvedValueOnce(undefined);

			const results = await Promise.all([
				evaluateGrant("org-1", "linear", "create_issue"),
				evaluateGrant("org-1", "linear", "create_issue"),
				evaluateGrant("org-1", "linear", "create_issue"),
			]);

			const granted = results.filter((r) => r.granted);
			expect(granted).toHaveLength(2);
		});
	});

	// ------------------------------------------
	// createGrant
	// ------------------------------------------

	describe("createGrant", () => {
		it("creates and returns a grant", async () => {
			const grant = makeGrant();
			mockCreateGrant.mockResolvedValue(grant);

			const result = await createGrant({
				organizationId: "org-1",
				createdBy: "user-1",
				integration: "linear",
				action: "create_issue",
				maxCalls: 10,
			});

			expect(result).toEqual(grant);
			expect(mockCreateGrant).toHaveBeenCalledWith({
				organizationId: "org-1",
				createdBy: "user-1",
				integration: "linear",
				action: "create_issue",
				maxCalls: 10,
			});
		});
	});

	// ------------------------------------------
	// revokeGrant
	// ------------------------------------------

	describe("revokeGrant", () => {
		it("revokes an existing grant", async () => {
			const grant = makeGrant({ revokedAt: new Date() });
			mockRevokeGrant.mockResolvedValue(grant);

			const result = await revokeGrant("grant-1", "org-1");

			expect(result.revokedAt).toBeTruthy();
			expect(mockRevokeGrant).toHaveBeenCalledWith("grant-1", "org-1");
		});

		it("throws GrantNotFoundError for non-existent grant", async () => {
			mockRevokeGrant.mockResolvedValue(undefined);

			await expect(revokeGrant("grant-x", "org-1")).rejects.toThrow(GrantNotFoundError);
		});
	});
});
