/**
 * Provider Contract Tests
 *
 * These tests define the behavioral contract that ALL sandbox providers must satisfy.
 * They ensure consistent behavior across E2B and any future providers.
 *
 * NOTE: The Modal provider lives in apps/gateway, not in this package.
 *
 * Run with: pnpm test -- provider-contract
 */

import { runtimeEnv } from "@proliferate/environment/runtime";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxProvider } from "./contract";

/**
 * Contract: Provider Interface Compliance
 */
describe("Provider Contract: Interface Compliance", () => {
	describe("E2BProvider", () => {
		it("should implement SandboxProvider interface", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			expect(provider.type).toBe("e2b");
			expect(typeof provider.createSandbox).toBe("function");
			expect(typeof provider.snapshot).toBe("function");
			expect(typeof provider.pause).toBe("function");
			expect(typeof provider.terminate).toBe("function");
			expect(typeof provider.writeEnvFile).toBe("function");
			expect(typeof provider.health).toBe("function");
			expect(typeof provider.checkSandboxes).toBe("function");
			expect(typeof provider.resolveTunnels).toBe("function");
		});
	});
});

/**
 * Contract: Error Handling
 */
describe("Provider Contract: Error Handling", () => {
	describe("E2BProvider.terminate", () => {
		it("should throw error when sandboxId is not provided", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			await expect(provider.terminate("session-123")).rejects.toThrow("sandboxId is required");
			await expect(provider.terminate("session-123", undefined)).rejects.toThrow(
				"sandboxId is required",
			);
		});
	});
});

/**
 * Contract: Health Check Behavior
 */
describe("Provider Contract: Health Check Behavior", () => {
	describe("E2BProvider.health", () => {
		const originalEnv = runtimeEnv.E2B_API_KEY;

		afterEach(() => {
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
});

/**
 * Contract: checkSandboxes Must Be Side-Effect Free
 *
 * checkSandboxes must NOT resume paused sandboxes, reset timeouts, or modify sandbox state.
 */
describe("Provider Contract: checkSandboxes Side Effects", () => {
	describe("E2BProvider.checkSandboxes", () => {
		it("should NOT use Sandbox.connect() which has side effects", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();
			const checkSandboxesFn =
				(provider.checkSandboxes as SandboxProvider["checkSandboxes"])!.toString();

			expect(checkSandboxesFn).not.toContain("Sandbox.connect");
			expect(checkSandboxesFn).not.toContain(".connect(");
		});

		it("should return empty array for empty input", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();

			const result = await provider.checkSandboxes!([]);
			expect(result).toEqual([]);
		});
	});
});

/**
 * Contract: Consistent Return Types
 */
describe("Provider Contract: Return Type Consistency", () => {
	describe("CreateSandboxResult shape", () => {
		it("E2BProvider.createSandbox should have correct signature", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();
			expect(typeof provider.createSandbox).toBe("function");
		});
	});

	describe("SnapshotResult shape", () => {
		it("E2BProvider.snapshot should have correct signature", async () => {
			const { E2BProvider } = await import("./e2b");
			const provider = new E2BProvider();
			expect(typeof provider.snapshot).toBe("function");
		});
	});
});
