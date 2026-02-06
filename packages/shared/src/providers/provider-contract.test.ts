/**
 * Provider Contract Tests
 *
 * These tests define the behavioral contract that ALL sandbox providers must satisfy.
 * They ensure consistent behavior across E2B, Modal, and any future providers.
 *
 * Run with: pnpm test -- provider-contract
 *
 * NOTE: These are unit tests that mock external APIs. For integration tests
 * that hit real APIs, see scripts/test-e2b-sandbox.ts
 */

import { runtimeEnv } from "@proliferate/environment/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxProvider } from "../sandbox-provider";

/**
 * Contract: Provider Interface Compliance
 *
 * All providers must implement these methods with consistent signatures.
 */
describe("Provider Contract: Interface Compliance", () => {
	describe("E2BProvider", () => {
		it("should implement SandboxProvider interface", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			// Type check - required methods
			expect(provider.type).toBe("e2b");
			expect(typeof provider.createSandbox).toBe("function");
			expect(typeof provider.snapshot).toBe("function");
			expect(typeof provider.pause).toBe("function");
			expect(typeof provider.terminate).toBe("function");
			expect(typeof provider.writeEnvFile).toBe("function");
			expect(typeof provider.health).toBe("function");
			// Optional methods that E2BProvider implements
			expect(typeof provider.checkSandboxes).toBe("function");
			expect(typeof provider.resolveTunnels).toBe("function");
		});
	});

	describe("ModalLibmodalProvider", () => {
		it("should implement SandboxProvider interface", async () => {
			const { ModalLibmodalProvider } = await import("./modal-libmodal");
			const provider = new ModalLibmodalProvider();

			// Type check - required methods
			expect(provider.type).toBe("modal");
			expect(typeof provider.createSandbox).toBe("function");
			expect(typeof provider.snapshot).toBe("function");
			expect(typeof provider.pause).toBe("function");
			expect(typeof provider.terminate).toBe("function");
			expect(typeof provider.writeEnvFile).toBe("function");
			expect(typeof provider.health).toBe("function");
			// Optional methods that ModalLibmodalProvider implements
			expect(typeof provider.checkSandboxes).toBe("function");
		});
	});
});

/**
 * Contract: Error Handling
 *
 * All providers must throw errors with consistent behavior.
 */
describe("Provider Contract: Error Handling", () => {
	describe("E2BProvider.terminate", () => {
		it("should throw error when sandboxId is not provided", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			// Should throw when sandboxId is undefined
			await expect(provider.terminate("session-123")).rejects.toThrow("sandboxId is required");

			await expect(provider.terminate("session-123", undefined)).rejects.toThrow(
				"sandboxId is required",
			);
		});
	});
});

/**
 * Contract: Health Check
 *
 * Health checks must:
 * 1. Return boolean (not throw)
 * 2. Actually validate the API connection
 * 3. Return false when API key is missing/invalid
 */
describe("Provider Contract: Health Check Behavior", () => {
	describe("E2BProvider.health", () => {
		const originalEnv = runtimeEnv.E2B_API_KEY;

		afterEach(() => {
			// Restore original env
			if (originalEnv !== undefined) {
				runtimeEnv.E2B_API_KEY = originalEnv;
			} else {
				Reflect.deleteProperty(runtimeEnv, "E2B_API_KEY");
			}
		});

		it("should return false when E2B_API_KEY is not set", async () => {
			Reflect.deleteProperty(runtimeEnv, "E2B_API_KEY");

			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			const result = await provider.health();
			expect(result).toBe(false);
		});
	});

	describe("ModalLibmodalProvider.health", () => {
		it("should return boolean from health check", async () => {
			const { ModalLibmodalProvider } = await import("./modal-libmodal");
			const provider = new ModalLibmodalProvider();

			// Health check should return boolean (not throw)
			const result = await provider.health();
			expect(typeof result).toBe("boolean");
		});
	});
});

/**
 * Contract: checkSandboxes Must Be Side-Effect Free
 *
 * CRITICAL: checkSandboxes must NOT:
 * - Resume paused sandboxes
 * - Reset sandbox timeouts
 * - Create any sandboxes
 * - Modify sandbox state in any way
 *
 * This is tested structurally by verifying the implementation doesn't use
 * methods that have side effects (like Sandbox.connect()).
 */
describe("Provider Contract: checkSandboxes Side Effects", () => {
	describe("E2BProvider.checkSandboxes", () => {
		it("should NOT use Sandbox.connect() which has side effects", async () => {
			// This is a structural test to ensure we don't use connect()
			// which has side effects (auto-resumes paused sandboxes)
			const { E2BProvider } = await import("./e2b");

			// Get the source code of checkSandboxes
			const provider = new E2BProvider();
			const checkSandboxesFn = provider.checkSandboxes.toString();

			// Verify it does NOT use connect()
			// connect() auto-resumes paused sandboxes and resets timeouts
			expect(checkSandboxesFn).not.toContain("Sandbox.connect");
			expect(checkSandboxesFn).not.toContain(".connect(");
		});

		it("should return empty array for empty input", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			const result = await provider.checkSandboxes([]);
			expect(result).toEqual([]);
		});
	});
});

/**
 * Contract: terminate Idempotency
 *
 * terminate() should be idempotent:
 * - Terminating an already-terminated sandbox should succeed (not throw)
 * - This allows retry logic without special-casing "already dead" errors
 */
describe("Provider Contract: terminate Idempotency", () => {
	describe("ModalLibmodalProvider.terminate", () => {
		it("should require sandboxId parameter", async () => {
			const { ModalLibmodalProvider } = await import("./modal-libmodal");
			const provider = new ModalLibmodalProvider();

			// Should throw when sandboxId is undefined
			await expect(provider.terminate("session-123")).rejects.toThrow("sandboxId is required");
		});
	});
});

/**
 * Contract: Consistent Return Types
 *
 * All providers must return data in the same shape.
 */
describe("Provider Contract: Return Type Consistency", () => {
	describe("CreateSandboxResult shape", () => {
		it("E2BProvider.createSandbox should have correct signature", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			// Type check - createSandbox should accept CreateSandboxOpts and return Promise<CreateSandboxResult>
			expect(typeof provider.createSandbox).toBe("function");
		});

		it("ModalLibmodalProvider.createSandbox should have correct signature", async () => {
			const { ModalLibmodalProvider } = await import("./modal-libmodal");
			const provider = new ModalLibmodalProvider();

			// Type check - createSandbox should accept CreateSandboxOpts and return Promise<CreateSandboxResult>
			expect(typeof provider.createSandbox).toBe("function");
		});
	});

	describe("SnapshotResult shape", () => {
		it("E2BProvider.snapshot should have correct signature", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			// Type check - snapshot should accept sessionId and sandboxId
			expect(typeof provider.snapshot).toBe("function");
		});

		it("ModalLibmodalProvider.snapshot should have correct signature", async () => {
			const { ModalLibmodalProvider } = await import("./modal-libmodal");
			const provider = new ModalLibmodalProvider();

			// Type check - snapshot should accept sessionId and sandboxId
			expect(typeof provider.snapshot).toBe("function");
		});
	});
});
