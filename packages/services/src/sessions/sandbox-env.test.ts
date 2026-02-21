import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../secrets", () => ({
	getScopedSecretsForSession: vi.fn(),
	getScopedSecretsForConfiguration: vi.fn(),
}));

vi.mock("../secret-files", () => ({
	listEncryptedByConfiguration: vi.fn(),
}));

vi.mock("../db/crypto", () => ({
	decrypt: vi.fn((value: string) => value),
	getEncryptionKey: vi.fn(() => "a".repeat(64)),
}));

vi.mock("../logger", () => ({
	getServicesLogger: () => ({
		child: () => ({
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		}),
	}),
}));

import * as secretFiles from "../secret-files";
import * as secrets from "../secrets";
import { resolveSessionBootSecretMaterial } from "./sandbox-env";

const mockSecrets = secrets as unknown as {
	getScopedSecretsForSession: ReturnType<typeof vi.fn>;
	getScopedSecretsForConfiguration: ReturnType<typeof vi.fn>;
};

const mockSecretFiles = secretFiles as unknown as {
	listEncryptedByConfiguration: ReturnType<typeof vi.fn>;
};

describe("resolveSessionBootSecretMaterial", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSecrets.getScopedSecretsForSession.mockResolvedValue([]);
		mockSecrets.getScopedSecretsForConfiguration.mockResolvedValue([]);
		mockSecretFiles.listEncryptedByConfiguration.mockResolvedValue([]);
	});

	it("applies precedence configuration > repo > org", async () => {
		mockSecrets.getScopedSecretsForSession.mockResolvedValue([
			{
				key: "SHARED_KEY",
				encryptedValue: "org-value",
				repoId: null,
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				key: "SHARED_KEY",
				encryptedValue: "repo-value",
				repoId: "repo-1",
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
			},
			{
				key: "ORG_ONLY",
				encryptedValue: "org-only",
				repoId: null,
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		]);
		mockSecrets.getScopedSecretsForConfiguration.mockResolvedValue([
			{
				key: "SHARED_KEY",
				encryptedValue: "configuration-value",
				repoId: null,
				updatedAt: new Date("2026-01-03T00:00:00.000Z"),
			},
		]);

		const result = await resolveSessionBootSecretMaterial({
			sessionId: "session-1",
			orgId: "org-1",
			repoIds: ["repo-1"],
			configurationId: "config-1",
		});

		expect(result.envVars).toEqual({
			SHARED_KEY: "configuration-value",
			ORG_ONLY: "org-only",
		});
	});

	it("returns decrypted file writes and skips invalid paths", async () => {
		mockSecretFiles.listEncryptedByConfiguration.mockResolvedValue([
			{
				id: "sf-1",
				organizationId: "org-1",
				configurationId: "config-1",
				filePath: "./apps/api/.env",
				encryptedContent: "API_KEY=abc123",
				updatedAt: new Date("2026-01-03T00:00:00.000Z"),
			},
			{
				id: "sf-2",
				organizationId: "org-1",
				configurationId: "config-1",
				filePath: "../escape/.env",
				encryptedContent: "SHOULD_NOT=appear",
				updatedAt: new Date("2026-01-03T00:00:00.000Z"),
			},
		]);

		const result = await resolveSessionBootSecretMaterial({
			sessionId: "session-1",
			orgId: "org-1",
			repoIds: [],
			configurationId: "config-1",
		});

		expect(result.fileWrites).toEqual([
			{
				filePath: "apps/api/.env",
				content: "API_KEY=abc123",
			},
		]);
	});
});
