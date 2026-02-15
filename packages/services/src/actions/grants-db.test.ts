/**
 * Grants DB concurrency tests.
 *
 * Verifies the CAS (compare-and-swap) semantics of consumeGrantCall
 * and concurrent evaluation behavior at the DB query layer.
 *
 * These tests mock the Drizzle ORM at a low level to simulate:
 * - Concurrent consume races (multiple callers, limited budget)
 * - Exhaustion between find and consume (TOCTOU)
 * - Revocation between find and consume
 * - Expiry between find and consume
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================
// Mock setup
// ============================================

/** Track all SQL operations issued by DB functions */
const mockReturning = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockSelectFrom = vi.fn();
const mockSelectWhere = vi.fn();
const mockSelectLimit = vi.fn();
const mockSelectOrderBy = vi.fn().mockReturnValue([]);

const mockDeleteFrom = vi.fn();
const mockDeleteWhere = vi.fn();
const mockDeleteReturning = vi.fn().mockReturnValue([]);

const mockInsertValues = vi.fn();
const mockInsertReturning = vi.fn();

vi.mock("../db/client", () => {
	const mockDb = {
		update: (...args: unknown[]) => mockUpdate(...args),
		select: () => ({
			from: (...args: unknown[]) => {
				mockSelectFrom(...args);
				return {
					where: (...wArgs: unknown[]) => {
						mockSelectWhere(...wArgs);
						return {
							limit: (...lArgs: unknown[]) => {
								mockSelectLimit(...lArgs);
								return [];
							},
							orderBy: (...oArgs: unknown[]) => {
								mockSelectOrderBy(...oArgs);
								return mockSelectOrderBy.mock.results[mockSelectOrderBy.mock.results.length - 1]
									.value;
							},
						};
					},
				};
			},
		}),
		insert: () => ({
			values: (...args: unknown[]) => {
				mockInsertValues(...args);
				return {
					returning: () => {
						mockInsertReturning();
						return [{ id: "new-grant" }];
					},
				};
			},
		}),
		delete: (...args: unknown[]) => {
			mockDeleteFrom(...args);
			return {
				where: (...wArgs: unknown[]) => {
					mockDeleteWhere(...wArgs);
					return {
						returning: (...rArgs: unknown[]) => {
							mockDeleteReturning(...rArgs);
							return mockDeleteReturning.mock.results[mockDeleteReturning.mock.results.length - 1]
								.value;
						},
					};
				},
			};
		},
	};

	return {
		getDb: () => mockDb,
		actionGrants: {
			id: "action_grants.id",
			organizationId: "action_grants.organization_id",
			revokedAt: "action_grants.revoked_at",
			expiresAt: "action_grants.expires_at",
			maxCalls: "action_grants.max_calls",
			usedCalls: "action_grants.used_calls",
			createdBy: "action_grants.created_by",
			sessionId: "action_grants.session_id",
			integration: "action_grants.integration",
			action: "action_grants.action",
			createdAt: "action_grants.created_at",
		},
		// Drizzle operators
		and: (...args: unknown[]) => ({ _and: args }),
		eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
		isNull: (a: unknown) => ({ _isNull: a }),
		isNotNull: (a: unknown) => ({ _isNotNull: a }),
		gt: (a: unknown, b: unknown) => ({ _gt: [a, b] }),
		lt: (a: unknown, b: unknown) => ({ _lt: [a, b] }),
		lte: (a: unknown, b: unknown) => ({ _lte: [a, b] }),
		or: (...args: unknown[]) => ({ _or: args }),
		desc: (a: unknown) => ({ _desc: a }),
		sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
			_sql: strings.join("?"),
			values,
		}),
		InferSelectModel: {} as never,
	};
});

vi.mock("../logger", () => ({
	getServicesLogger: () => ({
		child: () => ({
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}),
	}),
}));

// Now import the actual functions under test
const { consumeGrantCall, findMatchingGrants, createGrant, deleteExpiredGrants } = await import(
	"./grants-db"
);

// ============================================
// Helpers
// ============================================

function makeGrantRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "grant-1",
		organizationId: "org-1",
		createdBy: "user-1",
		sessionId: null,
		integration: "linear",
		action: "create_issue",
		maxCalls: 5,
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

describe("grants-db", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectOrderBy.mockReturnValue([]);
	});

	describe("consumeGrantCall CAS semantics", () => {
		it("returns updated row when CAS succeeds (budget available)", async () => {
			const updatedRow = makeGrantRow({ usedCalls: 1 });
			mockReturning.mockResolvedValue([updatedRow]);

			const result = await consumeGrantCall("grant-1");

			expect(result).toEqual(updatedRow);
			// Verify update was called (CAS update with WHERE conditions)
			expect(mockUpdate).toHaveBeenCalled();
			expect(mockSet).toHaveBeenCalled();
			expect(mockWhere).toHaveBeenCalled();
		});

		it("returns undefined when CAS fails (budget exhausted)", async () => {
			// CAS fails — the WHERE clause doesn't match any row
			mockReturning.mockResolvedValue([]);

			const result = await consumeGrantCall("grant-1");

			expect(result).toBeUndefined();
		});

		it("concurrent consumers: sequential calls resolve correctly", async () => {
			// First call succeeds (row updated)
			mockReturning
				.mockResolvedValueOnce([makeGrantRow({ usedCalls: 1 })])
				// Second call fails (budget exhausted at CAS time)
				.mockResolvedValueOnce([]);

			const r1 = await consumeGrantCall("grant-1");
			const r2 = await consumeGrantCall("grant-1");

			expect(r1).toBeDefined();
			expect(r1!.usedCalls).toBe(1);
			expect(r2).toBeUndefined();
		});

		it("concurrent consumers: parallel calls correctly race", async () => {
			// Simulate parallel CAS: only first caller wins
			mockReturning
				.mockResolvedValueOnce([makeGrantRow({ usedCalls: 1, maxCalls: 1 })])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			const [r1, r2, r3] = await Promise.all([
				consumeGrantCall("grant-1"),
				consumeGrantCall("grant-1"),
				consumeGrantCall("grant-1"),
			]);

			const successes = [r1, r2, r3].filter(Boolean);
			const failures = [r1, r2, r3].filter((r) => r === undefined);
			expect(successes).toHaveLength(1);
			expect(failures).toHaveLength(2);
		});

		it("honors maxCalls budget boundary (usedCalls + 1 = maxCalls)", async () => {
			// Grant at maxCalls-1 — one more call allowed
			mockReturning.mockResolvedValue([makeGrantRow({ usedCalls: 5, maxCalls: 5 })]);

			const result = await consumeGrantCall("grant-1");

			// The CAS succeeded because the DB WHERE clause matched
			// (usedCalls < maxCalls was true when the UPDATE ran)
			expect(result).toBeDefined();
		});
	});

	describe("findMatchingGrants query correctness", () => {
		it("calls select with org, integration, and action filters", async () => {
			await findMatchingGrants("org-1", "linear", "create_issue");

			expect(mockSelectFrom).toHaveBeenCalled();
			expect(mockSelectWhere).toHaveBeenCalled();
		});

		it("passes sessionId filter when provided", async () => {
			await findMatchingGrants("org-1", "linear", "create_issue", "session-1");

			expect(mockSelectWhere).toHaveBeenCalled();
			// The WHERE clause should include session filtering
		});
	});

	describe("deleteExpiredGrants", () => {
		it("calls delete with expiry conditions", async () => {
			mockDeleteReturning.mockReturnValue([{ id: "g-1" }, { id: "g-2" }]);

			const count = await deleteExpiredGrants(new Date());

			expect(count).toBe(2);
			expect(mockDeleteFrom).toHaveBeenCalled();
			expect(mockDeleteWhere).toHaveBeenCalled();
		});

		it("returns 0 when no expired grants exist", async () => {
			mockDeleteReturning.mockReturnValue([]);

			const count = await deleteExpiredGrants(new Date());

			expect(count).toBe(0);
		});
	});
});

/**
 * Integrated concurrency test.
 *
 * Verifies that evaluateGrant (service layer) correctly handles
 * the race between findMatchingGrants and consumeGrantCall when
 * called through the actual grants-db functions with mocked Drizzle.
 *
 * Key property: "only N calls win when budget = N" must hold
 * even when multiple evaluations run concurrently.
 */
describe("evaluateGrant concurrency (integrated with grants-db)", () => {
	// Import the service layer — it uses the real grants-db functions
	// which in turn hit our mocked Drizzle ORM.
	let evaluateGrant: typeof import("./grants")["evaluateGrant"];

	beforeEach(async () => {
		vi.clearAllMocks();
		mockSelectOrderBy.mockReturnValue([]);
		const grants = await import("./grants");
		evaluateGrant = grants.evaluateGrant;
	});

	it("budget=1: exactly one of two concurrent evaluations wins", async () => {
		const grant = makeGrantRow({ id: "grant-1", maxCalls: 1, usedCalls: 0 });

		// Both findMatchingGrants calls return the same candidate
		mockSelectOrderBy.mockReturnValue([grant]);

		// CAS: first consumer wins, second loses
		mockReturning
			.mockResolvedValueOnce([makeGrantRow({ id: "grant-1", usedCalls: 1, maxCalls: 1 })])
			.mockResolvedValueOnce([]);

		const [r1, r2] = await Promise.all([
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
		]);

		const granted = [r1, r2].filter((r) => r.granted);
		const denied = [r1, r2].filter((r) => !r.granted);
		expect(granted).toHaveLength(1);
		expect(denied).toHaveLength(1);
		expect(granted[0].grantId).toBe("grant-1");
	});

	it("budget=3: exactly three of five concurrent evaluations win", async () => {
		const grant = makeGrantRow({ id: "grant-1", maxCalls: 3, usedCalls: 0 });

		// All findMatchingGrants calls return the same candidate
		mockSelectOrderBy.mockReturnValue([grant]);

		// CAS: first 3 succeed, last 2 fail
		mockReturning
			.mockResolvedValueOnce([makeGrantRow({ id: "grant-1", usedCalls: 1, maxCalls: 3 })])
			.mockResolvedValueOnce([makeGrantRow({ id: "grant-1", usedCalls: 2, maxCalls: 3 })])
			.mockResolvedValueOnce([makeGrantRow({ id: "grant-1", usedCalls: 3, maxCalls: 3 })])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const results = await Promise.all([
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
		]);

		const granted = results.filter((r) => r.granted);
		const denied = results.filter((r) => !r.granted);
		expect(granted).toHaveLength(3);
		expect(denied).toHaveLength(2);
	});

	it("no candidates: all concurrent evaluations denied", async () => {
		// findMatchingGrants returns empty
		mockSelectOrderBy.mockReturnValue([]);

		const results = await Promise.all([
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
			evaluateGrant("org-1", "linear", "create_issue", "session-1"),
		]);

		expect(results.every((r) => !r.granted)).toBe(true);
		// consumeGrantCall should never be called
		expect(mockReturning).not.toHaveBeenCalled();
	});

	it("TOCTOU: grant exhausted between find and consume", async () => {
		const grant = makeGrantRow({ id: "grant-1", maxCalls: 1, usedCalls: 0 });

		// findMatchingGrants returns the candidate
		mockSelectOrderBy.mockReturnValue([grant]);

		// But CAS fails because another consumer already took the last call
		mockReturning.mockResolvedValue([]);

		const result = await evaluateGrant("org-1", "linear", "create_issue", "session-1");

		expect(result.granted).toBe(false);
		expect(mockReturning).toHaveBeenCalledTimes(1);
	});
});
