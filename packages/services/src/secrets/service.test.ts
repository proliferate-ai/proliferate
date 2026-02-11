import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer
vi.mock("./db", () => ({
	listByOrganization: vi.fn(),
	create: vi.fn(),
	deleteById: vi.fn(),
	findExistingKeys: vi.fn(),
	getSecretsForSession: vi.fn(),
	upsertByRepoAndKey: vi.fn(),
	updateSecretBundle: vi.fn(),
	bundleBelongsToOrg: vi.fn(),
	listBundlesByOrganization: vi.fn(),
	createBundle: vi.fn(),
	updateBundle: vi.fn(),
	deleteBundle: vi.fn(),
}));

// Mock crypto
vi.mock("../db/crypto", () => ({
	encrypt: vi.fn(() => "encrypted-value"),
	getEncryptionKey: vi.fn(() => "a".repeat(64)),
}));

import * as secretsDb from "./db";
import {
	BundleNotFoundError,
	BundleOrgMismatchError,
	DuplicateBundleError,
	DuplicateSecretError,
	checkSecrets,
	createBundle,
	createSecret,
	deleteBundle,
	deleteSecret,
	listBundles,
	listSecrets,
	updateBundleMeta,
	updateSecretBundle,
} from "./service";

const mockDb = secretsDb as unknown as {
	listByOrganization: ReturnType<typeof vi.fn>;
	create: ReturnType<typeof vi.fn>;
	deleteById: ReturnType<typeof vi.fn>;
	findExistingKeys: ReturnType<typeof vi.fn>;
	getSecretsForSession: ReturnType<typeof vi.fn>;
	updateSecretBundle: ReturnType<typeof vi.fn>;
	bundleBelongsToOrg: ReturnType<typeof vi.fn>;
	listBundlesByOrganization: ReturnType<typeof vi.fn>;
	createBundle: ReturnType<typeof vi.fn>;
	updateBundle: ReturnType<typeof vi.fn>;
	deleteBundle: ReturnType<typeof vi.fn>;
};

describe("secrets service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ============================================
	// Backward compatibility - existing secret flows
	// ============================================

	describe("listSecrets", () => {
		it("returns secrets with bundle_id field (null for unbundled)", async () => {
			mockDb.listByOrganization.mockResolvedValue([
				{
					id: "s1",
					key: "API_KEY",
					description: null,
					secret_type: "env",
					repo_id: null,
					bundle_id: null,
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
				bundle_id: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			});
		});

		it("returns secrets with bundle_id when assigned", async () => {
			mockDb.listByOrganization.mockResolvedValue([
				{
					id: "s1",
					key: "DB_URL",
					description: "Database URL",
					secret_type: "env",
					repo_id: null,
					bundle_id: "bundle-1",
					created_at: "2026-01-01T00:00:00.000Z",
					updated_at: "2026-01-01T00:00:00.000Z",
				},
			]);

			const result = await listSecrets("org-1");

			expect(result[0]!.bundle_id).toBe("bundle-1");
		});
	});

	describe("createSecret", () => {
		it("creates a secret without bundleId (backward compatible)", async () => {
			mockDb.create.mockResolvedValue({
				id: "s1",
				key: "SECRET_KEY",
				description: null,
				secret_type: "env",
				repo_id: null,
				bundle_id: null,
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
					bundleId: undefined,
				}),
			);
			expect(result.bundle_id).toBeNull();
		});

		it("creates a secret with bundleId", async () => {
			mockDb.bundleBelongsToOrg.mockResolvedValue(true);
			mockDb.create.mockResolvedValue({
				id: "s1",
				key: "DB_PASSWORD",
				description: null,
				secret_type: "env",
				repo_id: null,
				bundle_id: "bundle-1",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: null,
			});

			const result = await createSecret({
				organizationId: "org-1",
				userId: "user-1",
				key: "DB_PASSWORD",
				value: "password",
				bundleId: "bundle-1",
			});

			expect(mockDb.bundleBelongsToOrg).toHaveBeenCalledWith("bundle-1", "org-1");
			expect(mockDb.create).toHaveBeenCalledWith(
				expect.objectContaining({
					bundleId: "bundle-1",
				}),
			);
			expect(result.bundle_id).toBe("bundle-1");
		});

		it("rejects create with cross-org bundleId", async () => {
			mockDb.bundleBelongsToOrg.mockResolvedValue(false);

			await expect(
				createSecret({
					organizationId: "org-1",
					userId: "user-1",
					key: "LEAKED",
					value: "val",
					bundleId: "foreign-bundle",
				}),
			).rejects.toThrow(BundleOrgMismatchError);

			expect(mockDb.create).not.toHaveBeenCalled();
		});

		it("throws DuplicateSecretError on unique constraint violation", async () => {
			const pgError = Object.assign(new Error("unique_violation"), { code: "23505" });
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
	// Secret bundle assignment
	// ============================================

	describe("updateSecretBundle", () => {
		it("assigns a secret to a bundle", async () => {
			mockDb.bundleBelongsToOrg.mockResolvedValue(true);
			mockDb.updateSecretBundle.mockResolvedValue(true);

			const result = await updateSecretBundle("s1", "org-1", "bundle-1");

			expect(result).toBe(true);
			expect(mockDb.bundleBelongsToOrg).toHaveBeenCalledWith("bundle-1", "org-1");
			expect(mockDb.updateSecretBundle).toHaveBeenCalledWith("s1", "org-1", "bundle-1");
		});

		it("removes a secret from a bundle (set null)", async () => {
			mockDb.updateSecretBundle.mockResolvedValue(true);

			const result = await updateSecretBundle("s1", "org-1", null);

			expect(result).toBe(true);
			expect(mockDb.updateSecretBundle).toHaveBeenCalledWith("s1", "org-1", null);
		});

		it("returns false when secret not found", async () => {
			mockDb.bundleBelongsToOrg.mockResolvedValue(true);
			mockDb.updateSecretBundle.mockResolvedValue(false);

			const result = await updateSecretBundle("nonexistent", "org-1", "bundle-1");

			expect(result).toBe(false);
		});

		it("rejects reassignment with cross-org bundleId", async () => {
			mockDb.bundleBelongsToOrg.mockResolvedValue(false);

			await expect(
				updateSecretBundle("s1", "org-1", "foreign-bundle"),
			).rejects.toThrow(BundleOrgMismatchError);

			expect(mockDb.updateSecretBundle).not.toHaveBeenCalled();
		});

		it("skips ownership check when removing from bundle (null)", async () => {
			mockDb.updateSecretBundle.mockResolvedValue(true);

			const result = await updateSecretBundle("s1", "org-1", null);

			expect(result).toBe(true);
			expect(mockDb.bundleBelongsToOrg).not.toHaveBeenCalled();
		});
	});

	// ============================================
	// Bundle CRUD
	// ============================================

	describe("listBundles", () => {
		it("returns bundles with secret counts", async () => {
			mockDb.listBundlesByOrganization.mockResolvedValue([
				{
					id: "b1",
					name: "Production",
					description: "Production secrets",
					secret_count: 5,
					created_at: "2026-01-01T00:00:00.000Z",
					updated_at: "2026-01-01T00:00:00.000Z",
				},
				{
					id: "b2",
					name: "Staging",
					description: null,
					secret_count: 0,
					created_at: "2026-01-02T00:00:00.000Z",
					updated_at: null,
				},
			]);

			const result = await listBundles("org-1");

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({
				id: "b1",
				name: "Production",
				description: "Production secrets",
				secret_count: 5,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			});
			expect(result[1]!.secret_count).toBe(0);
		});
	});

	describe("createBundle", () => {
		it("creates a bundle and returns it with zero secret count", async () => {
			mockDb.createBundle.mockResolvedValue({
				id: "b1",
				name: "Production",
				description: "Prod secrets",
				secret_count: 0,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			});

			const result = await createBundle({
				organizationId: "org-1",
				userId: "user-1",
				name: "Production",
				description: "Prod secrets",
			});

			expect(result.name).toBe("Production");
			expect(result.secret_count).toBe(0);
		});

		it("throws DuplicateBundleError on unique constraint violation", async () => {
			const pgError = Object.assign(new Error("unique_violation"), { code: "23505" });
			mockDb.createBundle.mockRejectedValue(pgError);

			await expect(
				createBundle({
					organizationId: "org-1",
					userId: "user-1",
					name: "Duplicate",
				}),
			).rejects.toThrow(DuplicateBundleError);
		});
	});

	describe("updateBundleMeta", () => {
		it("updates bundle name/description", async () => {
			mockDb.updateBundle.mockResolvedValue({
				id: "b1",
				name: "Updated",
				description: "New desc",
				secret_count: 3,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-02T00:00:00.000Z",
			});

			const result = await updateBundleMeta("b1", "org-1", {
				name: "Updated",
				description: "New desc",
			});

			expect(result.name).toBe("Updated");
			expect(result.description).toBe("New desc");
		});

		it("throws BundleNotFoundError when bundle does not exist", async () => {
			mockDb.updateBundle.mockResolvedValue(null);

			await expect(
				updateBundleMeta("nonexistent", "org-1", { name: "X" }),
			).rejects.toThrow(BundleNotFoundError);
		});
	});

	describe("deleteBundle", () => {
		it("delegates to DB and returns true", async () => {
			mockDb.deleteBundle.mockResolvedValue(undefined);

			const result = await deleteBundle("b1", "org-1");

			expect(result).toBe(true);
			expect(mockDb.deleteBundle).toHaveBeenCalledWith("b1", "org-1");
		});
	});
});
