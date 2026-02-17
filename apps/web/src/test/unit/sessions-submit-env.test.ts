import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("@/lib/logger", () => ({
	logger: {
		child: () => ({
			info: vi.fn(),
			error: vi.fn(),
			child: () => ({ info: vi.fn(), error: vi.fn() }),
		}),
	},
}));

// Mock @proliferate/services
vi.mock("@proliferate/services", () => {
	class DuplicateSecretError extends Error {
		name = "DuplicateSecretError";
	}
	return {
		secrets: {
			createSecret: vi.fn(),
			DuplicateSecretError,
		},
		sessions: {
			getFullSession: vi.fn(),
		},
	};
});

// Mock sandbox provider
vi.mock("@proliferate/shared/providers", () => {
	const writeEnvFile = vi.fn();
	return {
		getSandboxProvider: () => ({
			type: "modal",
			writeEnvFile,
		}),
		__mockWriteEnvFile: writeEnvFile,
	};
});

import { submitEnvHandler } from "@/server/routers/sessions-submit-env";
import { secrets, sessions } from "@proliferate/services";
import * as providers from "@proliferate/shared/providers";

const mockCreateSecret = secrets.createSecret as ReturnType<typeof vi.fn>;
const mockGetFullSession = sessions.getFullSession as ReturnType<typeof vi.fn>;
const mockWriteEnvFile = (providers as unknown as { __mockWriteEnvFile: ReturnType<typeof vi.fn> })
	.__mockWriteEnvFile;

const baseSession = {
	id: "session-1",
	sandboxId: "sandbox-1",
	sandboxProvider: "modal",
	configurationId: "configuration-1",
};

const baseInput = {
	sessionId: "session-1",
	orgId: "org-1",
	userId: "user-1",
	secrets: [] as Array<{ key: string; value: string; persist?: boolean; description?: string }>,
	envVars: [] as Array<{ key: string; value: string }>,
	saveToConfiguration: true,
};

describe("submitEnvHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetFullSession.mockResolvedValue(baseSession);
		mockWriteEnvFile.mockResolvedValue(undefined);
		mockCreateSecret.mockResolvedValue({});
	});

	// ============================================
	// Backward compatibility
	// ============================================

	it("persists all secrets when saveToConfiguration is true (no per-secret flags)", async () => {
		const result = await submitEnvHandler({
			...baseInput,
			saveToConfiguration: true,
			secrets: [
				{ key: "API_KEY", value: "abc" },
				{ key: "DB_URL", value: "pg://localhost" },
			],
		});

		expect(mockCreateSecret).toHaveBeenCalledTimes(2);
		expect(result.results).toEqual([
			{ key: "API_KEY", persisted: true, alreadyExisted: false },
			{ key: "DB_URL", persisted: true, alreadyExisted: false },
		]);
	});

	it("skips persistence when saveToConfiguration is false (no per-secret flags)", async () => {
		const result = await submitEnvHandler({
			...baseInput,
			saveToConfiguration: false,
			secrets: [{ key: "API_KEY", value: "abc" }],
		});

		expect(mockCreateSecret).not.toHaveBeenCalled();
		expect(result.results).toEqual([{ key: "API_KEY", persisted: false, alreadyExisted: false }]);
	});

	// ============================================
	// Per-secret persist
	// ============================================

	it("honors mixed per-secret persist flags", async () => {
		const result = await submitEnvHandler({
			...baseInput,
			saveToConfiguration: false,
			secrets: [
				{ key: "PERSIST_ME", value: "val1", persist: true },
				{ key: "SESSION_ONLY", value: "val2", persist: false },
			],
		});

		expect(mockCreateSecret).toHaveBeenCalledTimes(1);
		expect(mockCreateSecret).toHaveBeenCalledWith(expect.objectContaining({ key: "PERSIST_ME" }));
		expect(result.results).toEqual([
			{ key: "PERSIST_ME", persisted: true, alreadyExisted: false },
			{ key: "SESSION_ONLY", persisted: false, alreadyExisted: false },
		]);
	});

	it("per-secret persist:false overrides global saveToConfiguration:true", async () => {
		const result = await submitEnvHandler({
			...baseInput,
			saveToConfiguration: true,
			secrets: [{ key: "TEMP_KEY", value: "val", persist: false }],
		});

		expect(mockCreateSecret).not.toHaveBeenCalled();
		expect(result.results[0]).toEqual({
			key: "TEMP_KEY",
			persisted: false,
			alreadyExisted: false,
		});
	});

	// ============================================
	// Duplicate handling
	// ============================================

	it("marks duplicate secrets as alreadyExisted", async () => {
		mockCreateSecret.mockRejectedValue(new secrets.DuplicateSecretError("exists"));

		const result = await submitEnvHandler({
			...baseInput,
			secrets: [{ key: "EXISTING", value: "val" }],
		});

		expect(result.submitted).toBe(true);
		expect(result.results[0]).toEqual({
			key: "EXISTING",
			persisted: false,
			alreadyExisted: true,
		});
	});

	// ============================================
	// Env vars are always session-only
	// ============================================

	it("never persists regular env vars regardless of saveToConfiguration", async () => {
		const result = await submitEnvHandler({
			...baseInput,
			saveToConfiguration: true,
			envVars: [{ key: "PORT", value: "3000" }],
		});

		expect(mockCreateSecret).not.toHaveBeenCalled();
		expect(mockWriteEnvFile).toHaveBeenCalledWith("sandbox-1", { PORT: "3000" });
		expect(result.results).toEqual([]);
	});

	// ============================================
	// Empty submission
	// ============================================

	it("returns empty results and skips writeEnvFile for empty submission", async () => {
		const result = await submitEnvHandler(baseInput);

		expect(mockWriteEnvFile).not.toHaveBeenCalled();
		expect(result).toEqual({ submitted: true, results: [] });
	});

	// ============================================
	// Session validation
	// ============================================

	it("throws NOT_FOUND when session does not exist", async () => {
		mockGetFullSession.mockResolvedValue(null);

		await expect(submitEnvHandler(baseInput)).rejects.toThrow("Session not found");
	});

	it("throws BAD_REQUEST when session has no sandbox", async () => {
		mockGetFullSession.mockResolvedValue({ ...baseSession, sandboxId: null });

		await expect(submitEnvHandler(baseInput)).rejects.toThrow("Session has no active sandbox");
	});

	// ============================================
	// Sandbox write
	// ============================================

	it("writes both secrets and env vars to sandbox", async () => {
		await submitEnvHandler({
			...baseInput,
			secrets: [{ key: "SECRET", value: "s-val", persist: false }],
			envVars: [{ key: "PORT", value: "3000" }],
		});

		expect(mockWriteEnvFile).toHaveBeenCalledWith("sandbox-1", {
			SECRET: "s-val",
			PORT: "3000",
		});
	});
});
