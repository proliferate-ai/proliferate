/**
 * Golden Contract Tests: Exit Code Mapping
 *
 * Every error class must map to the correct exit code.
 */

import { describe, expect, it } from "vitest";
import { CliError, ExitCode, mapHttpStatusToExitCode } from "../exit-codes.ts";

describe("ExitCode constants", () => {
	it("has correct values", () => {
		expect(ExitCode.Success).toBe(0);
		expect(ExitCode.Validation).toBe(2);
		expect(ExitCode.PolicyDenied).toBe(3);
		expect(ExitCode.ApprovalRequired).toBe(4);
		expect(ExitCode.Retryable).toBe(5);
		expect(ExitCode.Terminal).toBe(6);
	});

	it("has no duplicate values", () => {
		const values = Object.values(ExitCode);
		expect(new Set(values).size).toBe(values.length);
	});

	it("does not use 1 (reserved for general error)", () => {
		const values = Object.values(ExitCode);
		expect(values).not.toContain(1);
	});
});

describe("mapHttpStatusToExitCode", () => {
	it("maps 200 to Success", () => {
		expect(mapHttpStatusToExitCode(200)).toBe(ExitCode.Success);
	});

	it("maps 201 to Success", () => {
		expect(mapHttpStatusToExitCode(201)).toBe(ExitCode.Success);
	});

	it("maps 204 to Success", () => {
		expect(mapHttpStatusToExitCode(204)).toBe(ExitCode.Success);
	});

	it("maps 202 to ApprovalRequired", () => {
		expect(mapHttpStatusToExitCode(202)).toBe(ExitCode.ApprovalRequired);
	});

	it("maps 400 to Validation", () => {
		expect(mapHttpStatusToExitCode(400)).toBe(ExitCode.Validation);
	});

	it("maps 422 to Validation", () => {
		expect(mapHttpStatusToExitCode(422)).toBe(ExitCode.Validation);
	});

	it("maps 401 to Terminal", () => {
		expect(mapHttpStatusToExitCode(401)).toBe(ExitCode.Terminal);
	});

	it("maps 403 to PolicyDenied", () => {
		expect(mapHttpStatusToExitCode(403)).toBe(ExitCode.PolicyDenied);
	});

	it("maps 429 to Retryable", () => {
		expect(mapHttpStatusToExitCode(429)).toBe(ExitCode.Retryable);
	});

	it("maps 500 to Retryable", () => {
		expect(mapHttpStatusToExitCode(500)).toBe(ExitCode.Retryable);
	});

	it("maps 502 to Retryable", () => {
		expect(mapHttpStatusToExitCode(502)).toBe(ExitCode.Retryable);
	});

	it("maps 503 to Retryable", () => {
		expect(mapHttpStatusToExitCode(503)).toBe(ExitCode.Retryable);
	});

	it("maps 404 to Terminal", () => {
		expect(mapHttpStatusToExitCode(404)).toBe(ExitCode.Terminal);
	});

	it("maps 418 to Terminal", () => {
		expect(mapHttpStatusToExitCode(418)).toBe(ExitCode.Terminal);
	});
});

describe("CliError", () => {
	it("carries exit code", () => {
		const err = new CliError("bad input", ExitCode.Validation, "invalid_json");
		expect(err.message).toBe("bad input");
		expect(err.exitCode).toBe(ExitCode.Validation);
		expect(err.code).toBe("invalid_json");
		expect(err.name).toBe("CliError");
	});

	it("is instanceof Error", () => {
		const err = new CliError("fail", ExitCode.Terminal);
		expect(err).toBeInstanceOf(Error);
	});

	it("works without error code", () => {
		const err = new CliError("oops", ExitCode.Retryable);
		expect(err.code).toBeUndefined();
	});
});
