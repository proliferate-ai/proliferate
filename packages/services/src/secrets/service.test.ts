import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer
vi.mock("./db", () => ({
	listByOrganization: vi.fn(),
	create: vi.fn(),
	deleteById: vi.fn(),
	findExistingKeys: vi.fn(),
	getSecretsForSession: vi.fn(),
	bulkCreateSecrets: vi.fn(),
}));

// Mock crypto
vi.mock("../db/crypto", () => ({
	encrypt: vi.fn(() => "encrypted-value"),
	getEncryptionKey: vi.fn(() => "a".repeat(64)),
}));

import * as secretsDb from "./db";
import {
	DuplicateSecretError,
	bulkImportSecrets,
	checkSecrets,
	createSecret,
	deleteSecret,
	listSecrets,
} from "./service";

const mockDb = secretsDb as unknown as {
	listByOrganization: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	deleteById: ReturnType<typeof vi.fn>;
	findExistingKeys: ReturnType<typeof vi.fn>;
	getSecretsForSession: ReturnType<typeof vi.fn>;
	bulkCreateSecrets: ReturnType<typeof vi.fn>;
};

describe("secrets service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ============================================
	// Secret CRUD
	// ============================================

	describe("listSecrets", () => {
		it("returns secrets from the organization", async () => {
			mockDb.listByOrganization.mockResolvedValue([
				{
					id: "s1",
					key: "API_KEY",
					description: null,
					secret_type: "env",
					repo_id: null,
					configuration_id: null,
					created_at: "2026-01-01T00:00:00.000Z",
					updated_at: "2026-01-01T00:00:00.000Z",
				},
			]);

			const result = await listSecrets("org-1");

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: "s1",
				key: "API_KEY",
				description: null,
				secret_type: "env",
				repo_id: null,
				configuration_id: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			});
		});
	});

	describe("createSecret", () => {
		it("creates a secret and encrypts the value", async () => {
			mockDb.create.mockResolvedValue({
				id: "s1",
				key: "SECRET_KEY",
				description: null,
				secret_type: "env",
				repo_id: null,
				configuration_id: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: null,
			});

			const result = await createSecret({
				organizationId: "org-1",
				userId: "user-1",
				key: "SECRET_KEY",
				value: "secret-value",
			});

			expect(mockDb.create).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-1",
					key: "SECRET_KEY",
				}),
			);
			expect(result.key).toBe("SECRET_KEY");
		});

		it("throws DuplicateSecretError on unique constraint violation", async () => {
			const pgError = Object.assign(new Error("unique_violation"), {
				code: "23505",
			});
			mockDb.create.mockRejectedValue(pgError);

			await expect(
				createSecret({
					organizationId: "org-1",
					userId: "user-1",
					key: "DUPLICATE_KEY",
					value: "value",
				}),
			).rejects.toThrow(DuplicateSecretError);
		});
	});

	describe("deleteSecret", () => {
		it("delegates to DB and returns true", async () => {
			mockDb.deleteById.mockResolvedValue(undefined);
			const result = await deleteSecret("s1", "org-1");
			expect(result).toBe(true);
			expect(mockDb.deleteById).toHaveBeenCalledWith("s1", "org-1");
		});
	});

	describe("checkSecrets", () => {
		it("returns existence status for each key", async () => {
			mockDb.findExistingKeys.mockResolvedValue(["KEY_A"]);

			const result = await checkSecrets({
				organizationId: "org-1",
				keys: ["KEY_A", "KEY_B"],
			});

			expect(result).toEqual([
				{ key: "KEY_A", exists: true },
				{ key: "KEY_B", exists: false },
			]);
		});
	});

	// ============================================
	// Bulk import
	// ============================================

	describe("bulkImportSecrets", () => {
		it("parses env text, encrypts, and creates secrets", async () => {
			mockDb.bulkCreateSecrets.mockResolvedValue(["KEY_A", "KEY_B"]);

			const result = await bulkImportSecrets({
				organizationId: "org-1",
				userId: "user-1",
				envText: "KEY_A=value_a\nKEY_B=value_b",
			});

			expect(result).toEqual({ created: 2, skipped: [] });
			expect(mockDb.bulkCreateSecrets).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						key: "KEY_A",
						organizationId: "org-1",
					}),
					expect.objectContaining({
						key: "KEY_B",
						organizationId: "org-1",
					}),
				]),
			);
		});

		it("reports skipped duplicates", async () => {
			mockDb.bulkCreateSecrets.mockResolvedValue(["KEY_A"]);

			const result = await bulkImportSecrets({
				organizationId: "org-1",
				userId: "user-1",
				envText: "KEY_A=a\nKEY_B=b",
			});

			expect(result).toEqual({ created: 1, skipped: ["KEY_B"] });
		});

		it("returns zero created for empty input", async () => {
			const result = await bulkImportSecrets({
				organizationId: "org-1",
				userId: "user-1",
				envText: "# just a comment\n\n",
			});

			expect(result).toEqual({ created: 0, skipped: [] });
			expect(mockDb.bulkCreateSecrets).not.toHaveBeenCalled();
		});
	});
});
