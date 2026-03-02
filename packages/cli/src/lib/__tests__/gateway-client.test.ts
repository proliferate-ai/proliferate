/**
 * Golden Contract Tests: Gateway Client + Auth Refresh
 *
 * Tests auth expired/refresh behavior and capability version handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError, ExitCode } from "../exit-codes.ts";
import { gatewayRequest, getGatewayUrl, getSessionId, getSessionToken } from "../gateway-client.ts";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("getSessionToken", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns token from env", () => {
		process.env.PROLIFERATE_SESSION_TOKEN = "tok_abc";
		expect(getSessionToken()).toBe("tok_abc");
	});

	it("throws CliError when not set", () => {
		process.env.PROLIFERATE_SESSION_TOKEN = undefined;
		expect(() => getSessionToken()).toThrow(CliError);
		try {
			getSessionToken();
		} catch (err) {
			expect((err as CliError).exitCode).toBe(ExitCode.Terminal);
			expect((err as CliError).code).toBe("missing_token");
		}
	});
});

describe("getGatewayUrl", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns URL from env", () => {
		process.env.PROLIFERATE_GATEWAY_URL = "https://gw.example.com";
		expect(getGatewayUrl()).toBe("https://gw.example.com");
	});

	it("throws CliError when not set", () => {
		process.env.PROLIFERATE_GATEWAY_URL = undefined;
		expect(() => getGatewayUrl()).toThrow(CliError);
	});
});

describe("getSessionId", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns session ID from env", () => {
		process.env.PROLIFERATE_SESSION_ID = "sess_123";
		expect(getSessionId()).toBe("sess_123");
	});

	it("throws CliError when not set", () => {
		process.env.PROLIFERATE_SESSION_ID = undefined;
		expect(() => getSessionId()).toThrow(CliError);
	});
});

describe("gatewayRequest", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			PROLIFERATE_SESSION_TOKEN: "tok_test",
			PROLIFERATE_GATEWAY_URL: "https://gw.test.com",
			PROLIFERATE_SESSION_ID: "sess_test",
		};
		mockFetch.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("replaces :sessionId in path", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ result: "ok" }),
		});

		await gatewayRequest("/proliferate/:sessionId/info");

		expect(mockFetch).toHaveBeenCalledWith(
			"https://gw.test.com/proliferate/sess_test/info",
			expect.any(Object),
		);
	});

	it("returns success envelope for 200", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ sessionId: "s1", status: "running" }),
		});

		const result = await gatewayRequest("/proliferate/:sessionId");

		expect(result.envelope.ok).toBe(true);
		expect(result.envelope.data).toEqual({ sessionId: "s1", status: "running" });
		expect(result.envelope.error).toBeNull();
		expect(result.exitCode).toBe(ExitCode.Success);
	});

	it("returns error envelope for 400", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: async () => ({ error: "Bad request" }),
		});

		const result = await gatewayRequest("/proliferate/:sessionId");

		expect(result.envelope.ok).toBe(false);
		expect(result.envelope.error).toBe("Bad request");
		expect(result.exitCode).toBe(ExitCode.Validation);
	});

	it("returns exit code 4 for 202 (pending_approval)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 202,
			json: async () => ({
				invocationId: "inv_1",
				status: "pending_approval",
			}),
		});

		const result = await gatewayRequest("/proliferate/:sessionId/actions/invoke", {
			method: "POST",
		});

		expect(result.envelope.ok).toBe(true);
		expect(result.envelope.data).toEqual({
			invocationId: "inv_1",
			status: "pending_approval",
		});
		expect(result.exitCode).toBe(ExitCode.ApprovalRequired);
	});

	it("returns exit code 3 for 403 (policy denied)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 403,
			json: async () => ({ error: "Action not allowed" }),
		});

		const result = await gatewayRequest("/proliferate/:sessionId/actions/invoke", {
			method: "POST",
		});

		expect(result.envelope.ok).toBe(false);
		expect(result.envelope.error).toBe("Action not allowed");
		expect(result.exitCode).toBe(ExitCode.PolicyDenied);
	});

	it("retries once on 401 then succeeds", async () => {
		// First call returns 401
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({ error: "Unauthorized" }),
		});
		// Retry succeeds
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ data: "refreshed" }),
		});

		const result = await gatewayRequest("/proliferate/:sessionId");

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(result.envelope.ok).toBe(true);
		expect(result.exitCode).toBe(ExitCode.Success);
	});

	it("throws CliError with exit code 6 on double 401", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 401,
			json: async () => ({ error: "Unauthorized" }),
		});

		await expect(gatewayRequest("/proliferate/:sessionId")).rejects.toThrow(CliError);

		try {
			await gatewayRequest("/proliferate/:sessionId");
		} catch (err) {
			expect((err as CliError).exitCode).toBe(ExitCode.Terminal);
			expect((err as CliError).code).toBe("auth_expired");
		}
	});

	it("passes Authorization header", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({}),
		});

		await gatewayRequest("/proliferate/:sessionId");

		const [, opts] = mockFetch.mock.calls[0];
		expect(opts.headers.Authorization).toBe("Bearer tok_test");
	});

	it("returns retryable exit code for 500", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			json: async () => ({ error: "Internal server error" }),
		});

		const result = await gatewayRequest("/proliferate/:sessionId");
		expect(result.exitCode).toBe(ExitCode.Retryable);
	});

	it("includes sessionId in envelope meta", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({}),
		});

		const result = await gatewayRequest("/proliferate/:sessionId");
		expect(result.envelope.meta.sessionId).toBe("sess_test");
	});
});
