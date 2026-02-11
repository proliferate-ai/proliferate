import { describe, expect, it, vi } from "vitest";
import {
	type GatewayRequestFn,
	executeGrantRequest,
	executeGrantsList,
	parseGrantRequestFlags,
} from "./actions-grants";

// ============================================
// parseGrantRequestFlags
// ============================================

describe("parseGrantRequestFlags", () => {
	it("returns parsed values with defaults", () => {
		const result = parseGrantRequestFlags({
			integration: "sentry",
			action: "list-issues",
		});
		expect(result).toEqual({
			integration: "sentry",
			action: "list-issues",
			scope: "session",
		});
	});

	it("accepts --scope org", () => {
		const result = parseGrantRequestFlags({
			integration: "sentry",
			action: "*",
			scope: "org",
		});
		expect(result).toEqual({
			integration: "sentry",
			action: "*",
			scope: "org",
		});
	});

	it("accepts --max-calls as positive integer", () => {
		const result = parseGrantRequestFlags({
			integration: "linear",
			action: "create-issue",
			"max-calls": "10",
		});
		expect(result).toEqual({
			integration: "linear",
			action: "create-issue",
			scope: "session",
			maxCalls: 10,
		});
	});

	it("errors on missing --integration", () => {
		const result = parseGrantRequestFlags({ action: "foo" });
		expect(result).toEqual({
			error: "Missing required flag: --integration",
			exitCode: 2,
		});
	});

	it("errors on missing --action", () => {
		const result = parseGrantRequestFlags({ integration: "sentry" });
		expect(result).toEqual({
			error: "Missing required flag: --action",
			exitCode: 2,
		});
	});

	it("errors on invalid --scope", () => {
		const result = parseGrantRequestFlags({
			integration: "sentry",
			action: "foo",
			scope: "invalid",
		});
		expect(result).toEqual({
			error: "--scope must be 'session' or 'org'",
			exitCode: 2,
		});
	});

	it("errors on non-integer --max-calls", () => {
		const result = parseGrantRequestFlags({
			integration: "sentry",
			action: "foo",
			"max-calls": "abc",
		});
		expect(result).toEqual({
			error: "--max-calls must be a positive integer",
			exitCode: 2,
		});
	});

	it("errors on zero --max-calls", () => {
		const result = parseGrantRequestFlags({
			integration: "sentry",
			action: "foo",
			"max-calls": "0",
		});
		expect(result).toEqual({
			error: "--max-calls must be a positive integer",
			exitCode: 2,
		});
	});

	it("errors on negative --max-calls", () => {
		const result = parseGrantRequestFlags({
			integration: "sentry",
			action: "foo",
			"max-calls": "-5",
		});
		expect(result).toEqual({
			error: "--max-calls must be a positive integer",
			exitCode: 2,
		});
	});
});

// ============================================
// executeGrantRequest
// ============================================

describe("executeGrantRequest", () => {
	it("sends correct body and returns data on 201", async () => {
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 201,
			data: { grant: { id: "g1", integration: "sentry", action: "*" } },
		});

		const result = await executeGrantRequest(mockGateway, {
			integration: "sentry",
			action: "*",
			scope: "session",
			maxCalls: 5,
		});

		expect(mockGateway).toHaveBeenCalledWith("POST", "/grants", {
			integration: "sentry",
			action: "*",
			scope: "session",
			maxCalls: 5,
		});
		expect(result).toEqual({
			ok: true,
			data: { grant: { id: "g1", integration: "sentry", action: "*" } },
		});
	});

	it("omits maxCalls from body when undefined", async () => {
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 201,
			data: { grant: { id: "g2" } },
		});

		await executeGrantRequest(mockGateway, {
			integration: "linear",
			action: "create-issue",
			scope: "org",
		});

		expect(mockGateway).toHaveBeenCalledWith("POST", "/grants", {
			integration: "linear",
			action: "create-issue",
			scope: "org",
		});
	});

	it("returns error on 400", async () => {
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 400,
			data: { error: "Missing required fields: integration, action" },
		});

		const result = await executeGrantRequest(mockGateway, {
			integration: "",
			action: "",
			scope: "session",
		});

		expect(result).toEqual({
			ok: false,
			exitCode: 1,
			errorMessage: "Missing required fields: integration, action",
		});
	});

	it("returns error on 403", async () => {
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 403,
			data: { error: "Only sandbox agents can create grants" },
		});

		const result = await executeGrantRequest(mockGateway, {
			integration: "sentry",
			action: "foo",
			scope: "session",
		});

		expect(result).toEqual({
			ok: false,
			exitCode: 1,
			errorMessage: "Only sandbox agents can create grants",
		});
	});
});

// ============================================
// executeGrantsList
// ============================================

describe("executeGrantsList", () => {
	it("returns grants on success", async () => {
		const grants = [{ id: "g1", integration: "sentry", action: "*", usedCalls: 2, maxCalls: 10 }];
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 200,
			data: { grants },
		});

		const result = await executeGrantsList(mockGateway);

		expect(mockGateway).toHaveBeenCalledWith("GET", "/grants");
		expect(result).toEqual({ ok: true, data: { grants } });
	});

	it("returns empty array when no grants exist", async () => {
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 200,
			data: { grants: [] },
		});

		const result = await executeGrantsList(mockGateway);
		expect(result).toEqual({ ok: true, data: { grants: [] } });
	});

	it("returns error on server error", async () => {
		const mockGateway: GatewayRequestFn = vi.fn().mockResolvedValue({
			status: 500,
			data: { error: "Internal server error" },
		});

		const result = await executeGrantsList(mockGateway);
		expect(result).toEqual({
			ok: false,
			exitCode: 1,
			errorMessage: "Internal server error",
		});
	});
});
