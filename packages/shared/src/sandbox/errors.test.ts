import { describe, expect, it, vi } from "vitest";
import { SandboxProviderError, isSandboxProviderError, redactSecrets } from "./errors";

describe("redactSecrets", () => {
	it("should redact Anthropic API keys", () => {
		const input = "Error with key sk-ant-api03-abc123xyz";
		expect(redactSecrets(input)).toBe("Error with key [REDACTED]");
	});

	it("should redact GitHub tokens", () => {
		const input = "Auth failed with ghp_abc123xyz";
		expect(redactSecrets(input)).toBe("Auth failed with [REDACTED]");
	});

	it("should redact x-access-token patterns", () => {
		const input = "Clone from https://x-access-token:secret123@github.com/repo";
		expect(redactSecrets(input)).toBe("Clone from https://[REDACTED]github.com/repo");
	});

	it("should redact Bearer tokens", () => {
		const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test";
		expect(redactSecrets(input)).toBe("Authorization: [REDACTED]");
	});

	it("should redact JWT tokens", () => {
		const input =
			"Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
		expect(redactSecrets(input)).toBe("Token: [REDACTED]");
	});

	it("should redact api_key patterns", () => {
		const input = "Config has api_key: secret123abc";
		expect(redactSecrets(input)).toBe("Config has [REDACTED]");
	});

	it("should not modify safe text", () => {
		const input = "This is a normal error message without secrets";
		expect(redactSecrets(input)).toBe(input);
	});

	it("should handle multiple secrets in one string", () => {
		const input = "Keys: sk-ant-api03-abc123, ghp_xyz789";
		const result = redactSecrets(input);
		expect(result).not.toContain("sk-ant");
		expect(result).not.toContain("ghp_");
	});
});

describe("SandboxProviderError", () => {
	it("should create error with all properties", () => {
		const error = new SandboxProviderError({
			provider: "e2b",
			operation: "createSandbox",
			message: "Connection failed",
			statusCode: 500,
			isRetryable: true,
			raw: { detail: "Server error" },
		});

		expect(error.provider).toBe("e2b");
		expect(error.operation).toBe("createSandbox");
		expect(error.statusCode).toBe(500);
		expect(error.isRetryable).toBe(true);
		expect(error.raw).toEqual({ detail: "Server error" });
		expect(error.message).toContain("[e2b:createSandbox]");
		expect(error.message).toContain("Connection failed");
	});

	it("should default isRetryable to false", () => {
		const error = new SandboxProviderError({
			provider: "modal",
			operation: "terminate",
			message: "Not found",
		});

		expect(error.isRetryable).toBe(false);
	});

	it("should redact secrets in message", () => {
		const error = new SandboxProviderError({
			provider: "e2b",
			operation: "createSandbox",
			message: "Failed with token sk-ant-api03-secret123",
		});

		expect(error.message).toContain("[REDACTED]");
		expect(error.message).not.toContain("sk-ant-api03-secret123");
	});

	it("should set cause when provided", () => {
		const cause = new Error("Original error");
		const error = new SandboxProviderError({
			provider: "modal",
			operation: "snapshot",
			message: "Snapshot failed",
			cause,
		});

		expect(error.cause).toBe(cause);
	});

	describe("fromResponse", () => {
		it("should create error from JSON response", async () => {
			const response = new Response(JSON.stringify({ error: "Not authorized" }), {
				status: 401,
			});

			const error = await SandboxProviderError.fromResponse(response, "modal", "createSandbox");

			expect(error.provider).toBe("modal");
			expect(error.operation).toBe("createSandbox");
			expect(error.statusCode).toBe(401);
			expect(error.message).toContain("HTTP 401");
			expect(error.message).toContain("Not authorized");
		});

		it("should create error from text response", async () => {
			const response = new Response("Internal Server Error", { status: 500 });

			const error = await SandboxProviderError.fromResponse(response, "e2b", "terminate");

			expect(error.statusCode).toBe(500);
			expect(error.message).toContain("Internal Server Error");
		});

		it("should mark 429 as retryable", async () => {
			const response = new Response("Rate limited", { status: 429 });

			const error = await SandboxProviderError.fromResponse(response, "modal", "createSandbox");

			expect(error.isRetryable).toBe(true);
		});

		it("should mark 503 as retryable", async () => {
			const response = new Response("Service unavailable", { status: 503 });

			const error = await SandboxProviderError.fromResponse(response, "e2b", "health");

			expect(error.isRetryable).toBe(true);
		});

		it("should mark 400 as not retryable", async () => {
			const response = new Response("Bad request", { status: 400 });

			const error = await SandboxProviderError.fromResponse(response, "modal", "writeEnvFile");

			expect(error.isRetryable).toBe(false);
		});
	});

	describe("fromError", () => {
		it("should wrap Error objects", () => {
			const original = new Error("Network timeout");

			const error = SandboxProviderError.fromError(original, "e2b", "createSandbox");

			expect(error.message).toContain("Network timeout");
			expect(error.cause).toBe(original);
		});

		it("should wrap string errors", () => {
			const error = SandboxProviderError.fromError("Something went wrong", "modal", "terminate");

			expect(error.message).toContain("Something went wrong");
		});

		it("should return existing SandboxProviderError unchanged", () => {
			const original = new SandboxProviderError({
				provider: "e2b",
				operation: "snapshot",
				message: "Already failed",
			});

			const result = SandboxProviderError.fromError(
				original,
				"modal", // Different provider
				"terminate", // Different operation
			);

			// Should return the same error, not wrap it
			expect(result).toBe(original);
			expect(result.provider).toBe("e2b");
			expect(result.operation).toBe("snapshot");
		});

		it("should mark network errors as retryable", () => {
			const networkErrors = ["ECONNREFUSED", "ETIMEDOUT", "fetch failed", "network error"];

			for (const msg of networkErrors) {
				const error = SandboxProviderError.fromError(new Error(msg), "modal", "health");
				expect(error.isRetryable).toBe(true);
			}
		});
	});
});

describe("isSandboxProviderError", () => {
	it("should return true for SandboxProviderError", () => {
		const error = new SandboxProviderError({
			provider: "e2b",
			operation: "createSandbox",
			message: "Test",
		});

		expect(isSandboxProviderError(error)).toBe(true);
	});

	it("should return false for regular Error", () => {
		expect(isSandboxProviderError(new Error("Test"))).toBe(false);
	});

	it("should return false for null/undefined", () => {
		expect(isSandboxProviderError(null)).toBe(false);
		expect(isSandboxProviderError(undefined)).toBe(false);
	});

	it("should return false for string", () => {
		expect(isSandboxProviderError("error")).toBe(false);
	});
});
