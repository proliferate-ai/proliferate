import { normalizeSecretFilePathForSandbox } from "@/server/routers/secret-files";
import { describe, expect, it } from "vitest";

describe("normalizeSecretFilePathForSandbox", () => {
	it("accepts relative workspace paths", () => {
		expect(normalizeSecretFilePathForSandbox(".env.local")).toBe(".env.local");
		expect(normalizeSecretFilePathForSandbox("apps/web/.env.local")).toBe("apps/web/.env.local");
		expect(normalizeSecretFilePathForSandbox("apps\\web\\.env.local")).toBe("apps/web/.env.local");
	});

	it("rejects empty paths", () => {
		expect(() => normalizeSecretFilePathForSandbox("   ")).toThrow("Secret file path is required");
	});

	it("rejects absolute and traversal paths", () => {
		expect(() => normalizeSecretFilePathForSandbox("/etc/passwd")).toThrow(
			"Secret file path must be a relative path under workspace",
		);
		expect(() => normalizeSecretFilePathForSandbox("../../etc/passwd")).toThrow(
			"Secret file path must be a relative path under workspace",
		);
	});
});
